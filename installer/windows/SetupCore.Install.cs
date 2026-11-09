using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using Microsoft.Win32;

namespace IwxaSetup
{
    internal sealed class InstallOutcome
    {
        internal string Status;
        internal string Product;
        internal string Version;
        internal string Root;
    }

    internal sealed class SetupDiskPlan
    {
        internal string Status;
        internal long RequiredBytes;
        internal long AvailableBytes;
    }

    internal sealed class SetupLocations
    {
        internal string ProgramRoot;
        internal string DataRoot;
        internal string SoftwareRoot;
        internal string ModelsRoot;
        internal string CacheRoot;
        internal bool StartWithWindows;
    }

    internal static partial class SetupInstallation
    {
        private const string ReceiptFile = ".iwxa-setup-ownership.json";
        private const string UninstallExe = "IWXA.SetupCore.Uninstall.exe";
        private const string RegistryProducts = @"Software\IWXA\SetupCore\Products\";
        private const string WindowsUninstall = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\IWXA.SetupCore.";

        internal static string DefaultRootFor(BundleInfo info)
        {
            return Path.GetFullPath(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", info.InstallDir));
        }

        // After first install the registered location is authoritative for
        // repair, upgrade, rollback, launch and uninstall.
        internal static string RootFor(BundleInfo info)
        {
            using (var key = Registry.CurrentUser.OpenSubKey(
                RegistryProducts + info.Id))
            {
                if (key != null)
                    return ValidateInstallRoot(Convert.ToString(
                        key.GetValue("InstallLocation")));
            }
            return DefaultRootFor(info);
        }

        internal static string ValidateInstallRoot(string value)
        {
            if (String.IsNullOrWhiteSpace(value) || value.Length > 230 ||
                !Path.IsPathRooted(value) ||
                value.StartsWith(@"\\", StringComparison.Ordinal) ||
                value.Length < 4 || !Char.IsLetter(value[0]) ||
                value[1] != ':' || (value[2] != '\\' && value[2] != '/'))
                throw new InvalidOperationException("SETUP_INSTALL_ROOT_INVALID");
            string root;
            try { root = Path.GetFullPath(value.Trim()).TrimEnd('\\', '/'); }
            catch (Exception ex)
            {
                if (ex is ArgumentException || ex is NotSupportedException ||
                    ex is PathTooLongException)
                    throw new InvalidOperationException("SETUP_INSTALL_ROOT_INVALID");
                throw;
            }
            if (String.IsNullOrEmpty(root) ||
                SamePath(root, Path.GetPathRoot(root)))
                throw new InvalidOperationException("SETUP_INSTALL_ROOT_VOLUME_ROOT");
            foreach (string reserved in new [] {
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData)
            })
            {
                if (!String.IsNullOrWhiteSpace(reserved) &&
                    (SamePath(root, reserved) ||
                     root.StartsWith(Path.GetFullPath(reserved).TrimEnd('\\') + "\\",
                        StringComparison.OrdinalIgnoreCase)))
                    throw new InvalidOperationException("SETUP_INSTALL_ROOT_SYSTEM_FOLDER");
            }
            for (string part = root; !String.IsNullOrEmpty(part);
                 part = Path.GetDirectoryName(part))
            {
                if (File.Exists(part))
                    throw new InvalidOperationException("SETUP_INSTALL_ROOT_PARENT_FILE");
                if (Directory.Exists(part) &&
                    (File.GetAttributes(part) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("SETUP_INSTALL_ROOT_LINK");
                string parent = Path.GetDirectoryName(part);
                if (String.IsNullOrEmpty(parent) || parent == part) break;
            }
            return root;
        }

        internal static SetupLocations DefaultLocations(BundleInfo info)
        {
            string shared = Path.Combine(Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData), "IWXA");
            return new SetupLocations {
                ProgramRoot = RootFor(info),
                DataRoot = Path.Combine(Environment.GetFolderPath(
                    Environment.SpecialFolder.LocalApplicationData),
                    info.DataNamespace),
                SoftwareRoot = Path.Combine(shared, "Software"),
                ModelsRoot = Path.Combine(shared, "Models"),
                CacheRoot = Path.Combine(shared, "Cache"),
                StartWithWindows = false
            };
        }

        internal static SetupLocations InstalledLocations(BundleInfo info)
        {
            SetupLocations defaults = DefaultLocations(info);
            using (var owner = Registry.CurrentUser.OpenSubKey(
                RegistryProducts + info.Id))
            {
                if (owner == null) return defaults;
                string data = Convert.ToString(owner.GetValue("DataLocation"));
                string software = Convert.ToString(owner.GetValue("SoftwareLocation"));
                string models = Convert.ToString(owner.GetValue("ModelsLocation"));
                string cache = Convert.ToString(owner.GetValue("CacheLocation"));
                if (!String.IsNullOrWhiteSpace(data)) defaults.DataRoot = data;
                if (!String.IsNullOrWhiteSpace(software)) defaults.SoftwareRoot = software;
                if (!String.IsNullOrWhiteSpace(models)) defaults.ModelsRoot = models;
                if (!String.IsNullOrWhiteSpace(cache)) defaults.CacheRoot = cache;
            }
            defaults.StartWithWindows = StartupEnabled(info);
            return ValidateLocations(info, defaults, false);
        }

        private static bool PathOverlap(string a, string b)
        {
            return SamePath(a, b) ||
                a.StartsWith(b + "\\", StringComparison.OrdinalIgnoreCase) ||
                b.StartsWith(a + "\\", StringComparison.OrdinalIgnoreCase);
        }

        internal static SetupLocations ValidateLocations(BundleInfo info,
            SetupLocations requested, bool beforeFirstInstall = true)
        {
            if (requested == null)
                throw new InvalidOperationException("SETUP_LOCATIONS_NOT_SPECIFIED");
            var result = new SetupLocations {
                ProgramRoot = ValidateInstallRoot(requested.ProgramRoot),
                DataRoot = ValidateInstallRoot(requested.DataRoot),
                SoftwareRoot = ValidateInstallRoot(requested.SoftwareRoot),
                ModelsRoot = ValidateInstallRoot(requested.ModelsRoot),
                CacheRoot = ValidateInstallRoot(requested.CacheRoot),
                StartWithWindows = requested.StartWithWindows
            };
            string[] roots = { result.ProgramRoot, result.DataRoot,
                result.SoftwareRoot, result.ModelsRoot, result.CacheRoot };
            for (int i = 0; i < roots.Length; i++)
                for (int j = i + 1; j < roots.Length; j++)
                    if (PathOverlap(roots[i], roots[j]))
                        throw new InvalidOperationException(
                            "SETUP_STORAGE_LOCATIONS_OVERLAP");
            if (beforeFirstInstall)
            {
                // Never silently redirect an existing Tauri data store into
                // an empty alternative. That needs a separate data-migration
                // operation with readback and rollback.
                string existingData = DefaultLocations(info).DataRoot;
                if (!SamePath(result.DataRoot, existingData) &&
                    Directory.Exists(existingData) &&
                    Directory.GetFileSystemEntries(existingData).Length != 0)
                    throw new InvalidOperationException(
                        "SETUP_EXISTING_DATA_MIGRATION_REQUIRED");
            }
            return result;
        }

        // A first-time installation must not register model, cache or data
        // folders on disconnected drives. This is read-only and does not
        // create any directories or reserve space for optional downloads.
        internal static string UnavailableStorageVolume(SetupLocations choices)
        {
            if (choices == null)
                throw new InvalidOperationException("SETUP_LOCATIONS_NOT_SPECIFIED");
            foreach (string path in new [] { choices.DataRoot,
                choices.SoftwareRoot, choices.ModelsRoot, choices.CacheRoot })
            {
                string volume = Path.GetPathRoot(ValidateInstallRoot(path));
                if (!IsStorageVolumeReady(volume))
                    return volume;
            }
            return null;
        }

        private static bool IsStorageVolumeReady(string volume)
        {
            if (String.IsNullOrWhiteSpace(volume)) return false;
            try { return (new DriveInfo(volume)).IsReady; }
            catch (ArgumentException) { return false; }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
        }

        // Estimate destination space on each drive BEFORE any copy starts.
        // Include file allocation overhead and a fixed reserve for metadata.
        internal static long RequiredStorageMoveBytes(long sourceBytes,
            long fileCount)
        {
            if (sourceBytes < 0 || fileCount < 0)
                throw new ArgumentOutOfRangeException(
                    "sourceBytes", "SETUP_STORAGE_INVALID_SIZE");
            return checked(sourceBytes + sourceBytes / 50 +
                fileCount * 4096L + 64L * 1024 * 1024);
        }

        private sealed class StorageSpaceBudget
        {
            internal long Bytes;
            internal long Files;
        }

        private static StorageSpaceBudget RequireStorageMoveSpace(
            List<StorageCopy> moves, CancellationToken cancellation)
        {
            var volumes = new Dictionary<string, StorageSpaceBudget>(
                StringComparer.OrdinalIgnoreCase);
            var total = new StorageSpaceBudget();
            foreach (StorageCopy copy in moves)
            {
                cancellation.ThrowIfCancellationRequested();
                if (!Directory.Exists(copy.Original))
                    continue;
                string volume = Path.GetPathRoot(copy.Destination);
                StorageSpaceBudget budget;
                if (!volumes.TryGetValue(volume, out budget))
                {
                    budget = new StorageSpaceBudget();
                    volumes.Add(volume, budget);
                }
                var pending = new Stack<string>();
                pending.Push(copy.Original);
                while (pending.Count > 0)
                {
                    cancellation.ThrowIfCancellationRequested();
                    string current = pending.Pop();
                    if ((File.GetAttributes(current) &
                        FileAttributes.ReparsePoint) != 0)
                        throw new InvalidDataException(
                            "SETUP_STORAGE_SOURCE_LINK_FORBIDDEN");
                    foreach (string directory in Directory.GetDirectories(current))
                        pending.Push(directory);
                    foreach (string file in Directory.GetFiles(current))
                    {
                        cancellation.ThrowIfCancellationRequested();
                        if ((File.GetAttributes(file) &
                            FileAttributes.ReparsePoint) != 0)
                            throw new InvalidDataException(
                                "SETUP_STORAGE_FILE_LINK_FORBIDDEN");
                        long size = new FileInfo(file).Length;
                        budget.Bytes = checked(budget.Bytes + size);
                        budget.Files = checked(budget.Files + 1);
                        total.Bytes = checked(total.Bytes + size);
                        total.Files = checked(total.Files + 1);
                    }
                }
            }
            foreach (var volume in volumes)
            {
                var drive = new DriveInfo(volume.Key);
                if (!drive.IsReady)
                    throw new IOException("SETUP_STORAGE_VOLUME_UNAVAILABLE");
                long required = RequiredStorageMoveBytes(volume.Value.Bytes,
                    volume.Value.Files);
                long available = drive.AvailableFreeSpace;
                if (available < required)
                    throw new InvalidOperationException(
                        "SETUP_STORAGE_DISK_SPACE_INSUFFICIENT_required=" +
                        required + "_available=" + available +
                        "_volume=" + volume.Key);
            }
            cancellation.ThrowIfCancellationRequested();
            return total;
        }

        // Storage relocation is explicit and non-destructive. Copy and
        // hash-check every existing tree BEFORE switching the product-owned
        // registry paths. The originals remain as a recovery copy.
        internal static SetupLocations RelocateStorage(BundleInfo info,
            SetupLocations requested)
        {
            return RelocateStorage(info, requested,
                default(CancellationToken), null);
        }

        // Cancellation applies only until publication begins. The originals
        // are never deleted; a cancelled staged copy is cleaned up.
        internal static SetupLocations RelocateStorage(BundleInfo info,
            SetupLocations requested, CancellationToken cancellation,
            Action<long, long> progress)
        {
            cancellation.ThrowIfCancellationRequested();
            SetupLocations chosen = ValidateLocations(info, requested, false);
            using (var mutex = new System.Threading.Mutex(false,
                "Local\\IWXA.SetupCore." + info.Id))
            {
                if (!mutex.WaitOne(0))
                    throw new InvalidOperationException("SETUP_INSTALL_ALREADY_RUNNING");
                try
                {
                    string root = RootFor(info);
                    BundleInfo owned = ReadOwnedRelease(root, root, info.Id);
                    RequireRegistryOwnership(info.Id, root, owned);
                    AssertNotRunning(owned, root);
                    SetupLocations before = InstalledLocations(info);
                    if (!SamePath(before.ProgramRoot, chosen.ProgramRoot))
                        throw new InvalidOperationException(
                            "SETUP_PROGRAM_RELOCATION_REQUIRES_REINSTALL");
                    var oldRoots = new [] { before.DataRoot, before.SoftwareRoot,
                        before.ModelsRoot, before.CacheRoot };
                    var newRoots = new [] { chosen.DataRoot, chosen.SoftwareRoot,
                        chosen.ModelsRoot, chosen.CacheRoot };
                    var moved = new List<StorageCopy>();
                    for (int i = 0; i < oldRoots.Length; i++)
                    {
                        if (SamePath(oldRoots[i], newRoots[i])) continue;
                        foreach (string old in oldRoots)
                            if (PathOverlap(newRoots[i], old))
                                throw new InvalidOperationException(
                                    "SETUP_STORAGE_MOVE_OVERLAPS_OLD_LOCATION");
                        if (Directory.Exists(newRoots[i]) ||
                            File.Exists(newRoots[i]))
                            throw new InvalidOperationException(
                                "SETUP_STORAGE_TARGET_NOT_EMPTY_OR_EXISTS");
                        moved.Add(new StorageCopy {
                            Original = oldRoots[i], Destination = newRoots[i]
                        });
                    }
                    string unavailable = UnavailableStorageVolume(chosen);
                    if (!String.IsNullOrWhiteSpace(unavailable))
                        throw new IOException("SETUP_STORAGE_VOLUME_UNAVAILABLE_" +
                            unavailable);
                    // A disconnected source looks like an empty folder to
                    // Directory.Exists. Do not abandon a user's old data by
                    // treating an offline drive as an empty storage category.
                    foreach (StorageCopy copy in moved)
                    {
                        string sourceVolume = Path.GetPathRoot(copy.Original);
                        if (!IsStorageVolumeReady(sourceVolume))
                            throw new IOException(
                                "SETUP_STORAGE_SOURCE_VOLUME_UNAVAILABLE_" +
                                sourceVolume);
                    }
                    // Abort before creating staging directories or changing any
                    // registry preferences when the selected drives are too full.
                    StorageSpaceBudget budget =
                        RequireStorageMoveSpace(moved, cancellation);
                    long bytesCopied = 0;
                    if (progress != null) progress(0, budget.Bytes);
                    try
                    {
                        foreach (StorageCopy copy in moved)
                        {
                            cancellation.ThrowIfCancellationRequested();
                            if (!Directory.Exists(copy.Original))
                                continue; // Empty optional storage: no data to copy.
                            copy.Staged = copy.Destination + ".iwxa-copy-" +
                                Guid.NewGuid().ToString("N");
                            Directory.CreateDirectory(Path.GetDirectoryName(
                                copy.Destination));
                            if (Directory.Exists(copy.Staged) ||
                                File.Exists(copy.Staged))
                                throw new InvalidOperationException(
                                    "SETUP_STORAGE_STAGE_CONFLICT");
                            CopyVerifiedStorage(copy.Original, copy.Staged,
                                cancellation, delta => {
                                    bytesCopied = checked(bytesCopied + delta);
                                    if (progress != null)
                                        progress(bytesCopied, budget.Bytes);
                                });
                        }
                        cancellation.ThrowIfCancellationRequested();
                        // All source trees have been read back before changing
                        // even one product location or pointing at any new data.
                        foreach (StorageCopy copy in moved)
                            if (copy.Staged != null)
                            {
                                Directory.Move(copy.Staged, copy.Destination);
                                copy.Published = true;
                            }
                        using (var reg = Registry.CurrentUser.OpenSubKey(
                            RegistryProducts + info.Id, true))
                        {
                            if (reg == null ||
                                !SamePath(Convert.ToString(reg.GetValue(
                                    "InstallLocation")), root))
                                throw new InvalidOperationException(
                                    "SETUP_STORAGE_OWNER_CHANGED");
                            try
                            {
                                reg.SetValue("DataLocation", chosen.DataRoot);
                                reg.SetValue("SoftwareLocation", chosen.SoftwareRoot);
                                reg.SetValue("ModelsLocation", chosen.ModelsRoot);
                                reg.SetValue("CacheLocation", chosen.CacheRoot);
                            }
                            catch
                            {
                                // The old data is still intact; restore the
                                // four preferences if a registry write fails.
                                reg.SetValue("DataLocation", before.DataRoot);
                                reg.SetValue("SoftwareLocation", before.SoftwareRoot);
                                reg.SetValue("ModelsLocation", before.ModelsRoot);
                                reg.SetValue("CacheLocation", before.CacheRoot);
                                throw;
                            }
                        }
                        return InstalledLocations(info);
                    }
                    finally
                    {
                        foreach (StorageCopy copy in moved)
                            if (copy.Staged != null &&
                                Directory.Exists(copy.Staged))
                                Directory.Delete(copy.Staged, true);
                        // Published copies are deliberately retained if a
                        // later registry operation fails. They belong to the
                        // user, and no original tree was removed.
                    }
                }
                finally { mutex.ReleaseMutex(); }
            }
        }

        // Settings share the existing storage and shortcut mechanisms. Check
        // the startup target before a costly storage copy; publish locations
        // only through RelocateStorage, then verify both settings from Windows.
        internal static SetupLocations ApplyPreferences(BundleInfo info,
            SetupLocations requested)
        {
            return ApplyPreferences(info, requested,
                default(CancellationToken), null);
        }

        internal static SetupLocations ApplyPreferences(BundleInfo info,
            SetupLocations requested, CancellationToken cancellation,
            Action<long, long> progress)
        {
            cancellation.ThrowIfCancellationRequested();
            SetupLocations desired = ValidateLocations(info, requested, false);
            SetupLocations before = InstalledLocations(info);
            if (!SamePath(before.ProgramRoot, desired.ProgramRoot))
                throw new InvalidOperationException(
                    "SETUP_PROGRAM_RELOCATION_REQUIRES_REINSTALL");

            // A foreign Windows Startup shortcut must block the change before
            // any storage copy. Never silently overwrite another application.
            EnsureStartupAvailable(info, desired.StartWithWindows);
            bool moving = !SamePath(before.DataRoot, desired.DataRoot) ||
                !SamePath(before.SoftwareRoot, desired.SoftwareRoot) ||
                !SamePath(before.ModelsRoot, desired.ModelsRoot) ||
                !SamePath(before.CacheRoot, desired.CacheRoot);
            if (moving)
                RelocateStorage(info, desired, cancellation, progress);

            // RelocateStorage has already published the new locations at this
            // point. Cancellation is deliberately no longer consulted.
            UpdateStartup(info, desired.StartWithWindows);
            SetupLocations actual = InstalledLocations(info);
            if (!SamePath(actual.ProgramRoot, desired.ProgramRoot) ||
                !SamePath(actual.DataRoot, desired.DataRoot) ||
                !SamePath(actual.SoftwareRoot, desired.SoftwareRoot) ||
                !SamePath(actual.ModelsRoot, desired.ModelsRoot) ||
                !SamePath(actual.CacheRoot, desired.CacheRoot) ||
                actual.StartWithWindows != desired.StartWithWindows)
                throw new InvalidDataException("SETUP_SETTINGS_READBACK_MISMATCH");
            return actual;
        }

        private sealed class StorageCopy
        {
            internal string Original;
            internal string Destination;
            internal string Staged;
            internal bool Published;
        }

        private static void CopyVerifiedStorage(string original, string staged,
            CancellationToken cancellation, Action<long> bytesCopied)
        {
            cancellation.ThrowIfCancellationRequested();
            if ((File.GetAttributes(original) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("SETUP_STORAGE_SOURCE_LINK_FORBIDDEN");
            Directory.CreateDirectory(staged);
            var pending = new Stack<string>();
            pending.Push(original);
            while (pending.Count > 0)
            {
                cancellation.ThrowIfCancellationRequested();
                string current = pending.Pop();
                string relative = current.Substring(original.Length).TrimStart('\\');
                string targetDir = relative.Length == 0 ? staged :
                    Path.Combine(staged, relative);
                Directory.CreateDirectory(targetDir);
                foreach (string dir in Directory.GetDirectories(current))
                {
                    if ((File.GetAttributes(dir) & FileAttributes.ReparsePoint) != 0)
                        throw new InvalidDataException(
                            "SETUP_STORAGE_SOURCE_LINK_FORBIDDEN");
                    pending.Push(dir);
                }
                foreach (string originalFile in Directory.GetFiles(current))
                {
                    cancellation.ThrowIfCancellationRequested();
                    if ((File.GetAttributes(originalFile) &
                        FileAttributes.ReparsePoint) != 0)
                        throw new InvalidDataException(
                            "SETUP_STORAGE_FILE_LINK_FORBIDDEN");
                    string newFile = Path.Combine(targetDir,
                        Path.GetFileName(originalFile));
                    byte[] sourceHash;
                    const int blockSize = 1024 * 1024;
                    byte[] buffer = new byte[blockSize];
                    using (var digest = SHA256.Create())
                    using (var input = new FileStream(originalFile, FileMode.Open,
                        FileAccess.Read, FileShare.Read, blockSize,
                        FileOptions.SequentialScan))
                    using (var output = new FileStream(newFile, FileMode.CreateNew,
                        FileAccess.Write, FileShare.None, blockSize,
                        FileOptions.SequentialScan))
                    {
                        int length;
                        while ((length = input.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            cancellation.ThrowIfCancellationRequested();
                            digest.TransformBlock(buffer, 0, length, buffer, 0);
                            output.Write(buffer, 0, length);
                            if (bytesCopied != null) bytesCopied(length);
                        }
                        digest.TransformFinalBlock(new byte[0], 0, 0);
                        sourceHash = digest.Hash;
                        output.Flush();
                    }
                    cancellation.ThrowIfCancellationRequested();
                    byte[] copiedHash;
                    using (var digest = SHA256.Create())
                    using (var verification = new FileStream(newFile,
                        FileMode.Open, FileAccess.Read, FileShare.Read,
                        blockSize, FileOptions.SequentialScan))
                    {
                        int length;
                        while ((length = verification.Read(buffer, 0, buffer.Length)) > 0)
                        {
                            cancellation.ThrowIfCancellationRequested();
                            digest.TransformBlock(buffer, 0, length, buffer, 0);
                        }
                        digest.TransformFinalBlock(new byte[0], 0, 0);
                        copiedHash = digest.Hash;
                    }
                    if (!StructuralComparisons.StructuralEqualityComparer.Equals(
                            sourceHash, copiedHash) ||
                        new FileInfo(originalFile).Length !=
                            new FileInfo(newFile).Length)
                        throw new InvalidDataException(
                            "SETUP_STORAGE_COPY_READBACK_FAILED");
                }
            }
        }

        internal static SetupDiskPlan CheckStageSpace(BundleInfo info, string selectedRoot = null)
        {
            // Verified unpacked bytes + a complete same-volume installer copy.
            // The existing release is moved, not copied, during upgrade.
            // Reserve 64 MiB plus 2% for NTFS metadata and extraction overhead.
            if (info.PayloadBytes <= 0 || info.PackageBytes <= 0)
                throw new InvalidDataException("SETUP_DISK_PACKAGE_SIZE_UNKNOWN");
            long required = checked(info.PayloadBytes + info.PackageBytes +
                64L * 1024 * 1024 + info.PayloadBytes / 50);
            string driveRoot = Path.GetPathRoot(selectedRoot == null ? RootFor(info) : ValidateInstallRoot(selectedRoot));
            if (String.IsNullOrWhiteSpace(driveRoot))
                throw new IOException("SETUP_DISK_VOLUME_UNAVAILABLE");
            var volume = new DriveInfo(driveRoot);
            if (!volume.IsReady)
                throw new IOException("SETUP_DISK_VOLUME_UNAVAILABLE");
            long available = volume.AvailableFreeSpace;
            return new SetupDiskPlan {
                Status = available >= required ?
                    "DISK_SPACE_READY" : "DISK_SPACE_INSUFFICIENT",
                RequiredBytes = required,
                AvailableBytes = available
            };
        }

        private static void RequireStageSpace(BundleInfo info, string selectedRoot = null)
        {
            SetupDiskPlan disk = CheckStageSpace(info, selectedRoot);
            if (disk.Status != "DISK_SPACE_READY")
                throw new InvalidOperationException(
                    "SETUP_DISK_SPACE_INSUFFICIENT_required=" +
                    disk.RequiredBytes + "_available=" + disk.AvailableBytes);
        }

        internal static InstallOutcome InstallFresh(string bundle)
        {
            BundleInfo info = BundleReader.Inspect(bundle);
            return InstallFreshVerified(bundle, info, DefaultLocations(info));
        }

        internal static InstallOutcome InstallFresh(string bundle, string selectedRoot)
        {
            return InstallFresh(bundle, selectedRoot, false);
        }

        internal static InstallOutcome InstallFresh(string bundle,
            string selectedRoot, bool startWithWindows)
        {
            BundleInfo info = BundleReader.Inspect(bundle);
            SetupLocations locations = DefaultLocations(info);
            locations.ProgramRoot = selectedRoot;
            locations.StartWithWindows = startWithWindows;
            return InstallFreshVerified(bundle, info, locations);
        }

        internal static InstallOutcome InstallFresh(string bundle,
            SetupLocations selected)
        {
            BundleInfo info = BundleReader.Inspect(bundle);
            return InstallFreshVerified(bundle, info, selected);
        }

        private static InstallOutcome InstallFreshVerified(
            string bundle, BundleInfo info, SetupLocations selected)
        {
            SetupLocations choices = ValidateLocations(info, selected);
            string unavailable = UnavailableStorageVolume(choices);
            if (!String.IsNullOrWhiteSpace(unavailable))
                throw new IOException("SETUP_STORAGE_VOLUME_UNAVAILABLE_" + unavailable);
            // Refuse a colliding Windows Startup shortcut before touching the
            // installation directory or product registry. The same request
            // can proceed by choosing manual startup instead.
            EnsureStartupAvailable(info, choices.ProgramRoot,
                choices.StartWithWindows);
            using (var mutex = new System.Threading.Mutex(false, "Local\\IWXA.SetupCore." + info.Id))
            {
                if (!mutex.WaitOne(0))
                    throw new InvalidOperationException("SETUP_INSTALL_ALREADY_RUNNING");
                try { return InstallLocked(bundle, info, null, choices.ProgramRoot,
                    choices.StartWithWindows, choices); }
                finally { mutex.ReleaseMutex(); }
            }
        }

        // An explicit preview of a registered NSIS installation. It installs
        // our separate native-owned root; old NSIS files, registry and shortcuts
        // stay untouched until a future verified, user-approved handoff.
        internal static InstallOutcome StageLegacy(string bundle)
        {
            BundleInfo candidate = BundleReader.Inspect(bundle);
            using (var mutex = new System.Threading.Mutex(false,
                "Local\\IWXA.SetupCore." + candidate.Id))
            {
                if (!mutex.WaitOne(0))
                    throw new InvalidOperationException("SETUP_INSTALL_ALREADY_RUNNING");
                try
                {
                    InstallPreflight preflight = SetupReadiness.Check(candidate);
                    if (preflight.Status != "LEGACY_INSTALLATION")
                        throw new InvalidOperationException(
                            "SETUP_LEGACY_STAGE_BLOCKED_" + preflight.Status);
                    LegacyAssessment legacy = SetupLegacy.Inspect(candidate);
                    if (legacy.Status != "LEGACY_CONFIRMED_READ_ONLY")
                        throw new InvalidOperationException(
                            "SETUP_LEGACY_OWNER_NOT_CONFIRMED_" + legacy.Status);
                    if (CompareVersions(candidate.Version, legacy.Version) <= 0)
                        throw new InvalidOperationException(
                            "SETUP_LEGACY_DOWNGRADE_BLOCKED");
                    if (candidate.NeedsWebView2 &&
                        String.IsNullOrWhiteSpace(
                            SetupReadiness.DetectWebView2Version()))
                        throw new InvalidOperationException(
                            "SETUP_LEGACY_WEBVIEW2_MISSING");
                    AssertNotRunning(candidate, legacy.Root);
                    return InstallLocked(bundle, candidate, legacy);
                }
                finally { mutex.ReleaseMutex(); }
            }
        }

        private static InstallOutcome InstallLocked(string bundle, BundleInfo info,
            LegacyAssessment legacy = null, string selectedRoot = null,
            bool startWithWindows = false, SetupLocations locations = null)
        {
            string root = selectedRoot == null ? RootFor(info) : ValidateInstallRoot(selectedRoot);
            InstallPreflight readiness = SetupReadiness.Check(info, root);
            if (legacy == null && readiness.Status != "READY_FOR_FIRST_INSTALL")
                throw new InvalidOperationException("SETUP_BLOCKED_" + readiness.Status);
            if (legacy != null && readiness.Status != "LEGACY_INSTALLATION")
                throw new InvalidOperationException("SETUP_LEGACY_STATE_CHANGED");
            RequireStageSpace(info, root);
            string parent = Path.GetDirectoryName(root);
            Directory.CreateDirectory(parent);
            if (Directory.Exists(root) || File.Exists(root))
                throw new InvalidOperationException("SETUP_INSTALL_ALREADY_EXISTS");

            // Same-volume, isolated stage. No existing application, data or
            // Atlas process is stopped or modified by S2 first-install.
            string staged = root + ".iwxa-new-" + Guid.NewGuid().ToString("N");
            bool activated = false;
            Directory.CreateDirectory(staged);
            try
            {
                PrepareVerifiedStage(bundle, info, staged, root, legacy);
                if (locations != null)
                {
                    string unavailable = UnavailableStorageVolume(locations);
                    if (!String.IsNullOrWhiteSpace(unavailable))
                        throw new IOException("SETUP_STORAGE_VOLUME_UNAVAILABLE_" +
                            unavailable);
                }

                Directory.Move(staged, root);
                activated = true;

                Register(info, root);
                if (locations != null)
                {
                    using (var authority = Registry.CurrentUser.OpenSubKey(
                        RegistryProducts + info.Id, true))
                    {
                        if (authority == null)
                            throw new InvalidOperationException(
                                "SETUP_LOCATIONS_AUTHORITY_MISSING");
                        authority.SetValue("DataLocation", locations.DataRoot);
                        authority.SetValue("SoftwareLocation", locations.SoftwareRoot);
                        authority.SetValue("ModelsLocation", locations.ModelsRoot);
                        authority.SetValue("CacheLocation", locations.CacheRoot);
                    }
                }
                // The original NSIS shortcut must remain usable while the
                // preview is being qualified.
                if (legacy == null)
                {
                    CreateShortcut(info, root);
                    if (startWithWindows) SetStartupShortcut(info, root, true);
                }
                return new InstallOutcome {
                    Status = legacy == null ?
                        "INSTALLED_NOT_LAUNCHED" :
                        "LEGACY_MIGRATION_STAGED_NSIS_PRESERVED", Product = info.Id,
                    Version = info.Version, Root = root
                };
            }
            catch
            {
                // Roll back only the new directory created by this operation.
                // Never touch a legacy NSIS directory or user-owned data.
                if (activated)
                {
                    DeleteShortcut(info);
                    DeleteStartupShortcut(info, root);
                    Deregister(info, root);
                }
                if (activated && Directory.Exists(root))
                {
                    try { Directory.Delete(root, true); }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
                throw;
            }
            finally
            {
                if (Directory.Exists(staged))
                    Directory.Delete(staged, true);
            }
        }

        private static void PrepareVerifiedStage(string bundle, BundleInfo info,
            string staged, string root, LegacyAssessment legacy = null)
        {
            BundleInfo verified = BundleReader.ExtractVerified(bundle, staged);
            if (verified.Id != info.Id || verified.PackageSha256 != info.PackageSha256 ||
                verified.SourceCommit != info.SourceCommit)
                throw new InvalidDataException("SETUP_PACKAGE_CHANGED_DURING_STAGE");

            string appPath = Path.Combine(staged,
                verified.Entrypoint.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(appPath))
                throw new InvalidDataException("SETUP_ENTRYPOINT_NOT_STAGED");

            // Keep the original verified package as a self-contained
            // registered uninstaller. No Python or additional framework
            // has to be installed on the user's Windows machine.
            string packagedUninstaller = Path.Combine(staged, UninstallExe);
            if (File.Exists(packagedUninstaller) ||
                File.Exists(Path.Combine(staged, ReceiptFile)))
                throw new InvalidDataException("SETUP_RESERVED_FILE_COLLISION");
            File.Copy(bundle, packagedUninstaller);

            var installedFiles = new List<string>();
            foreach (string f in Directory.GetFiles(staged, "*", SearchOption.AllDirectories))
                installedFiles.Add(f.Substring(staged.Length + 1)
                    .Replace(Path.DirectorySeparatorChar, '/'));
            installedFiles.Sort(StringComparer.OrdinalIgnoreCase);
            var receipt = new Dictionary<string, object> {
                {"schema", "IWXA_SETUP_OWNERSHIP/1"}, {"product", info.Id},
                {"version", info.Version}, {"sourceCommit", info.SourceCommit},
                {"packageSha256", info.PackageSha256}, {"installRoot", root},
                {"files", installedFiles}
            };
            if (legacy != null)
            {
                // The preview must not silently adopt a different or replaced
                // NSIS 0.2 binary between staging and the handoff decision.
                // Preserve identity evidence only; never uninstall legacy here.
                string originalExe = Path.Combine(legacy.Root,
                    verified.Entrypoint.Replace('/', Path.DirectorySeparatorChar));
                receipt["legacyHandoff"] = new Dictionary<string, object> {
                    {"schema", "IWXA_SETUP_LEGACY_HANDOFF/1"},
                    {"root", legacy.Root},
                    {"version", legacy.Version},
                    {"registryName", legacy.RegistryName},
                    {"uninstaller", legacy.Uninstaller},
                    {"applicationSha256", FingerprintLegacyFile(originalExe)},
                    {"uninstallerSha256", FingerprintLegacyFile(legacy.Uninstaller)},
                    {"status", "PREVIEW_ONLY_NSIS_RETAINED"}
                };
            }
            File.WriteAllText(Path.Combine(staged, ReceiptFile),
                new JavaScriptSerializer().Serialize(receipt) + "\n",
                new UTF8Encoding(false));

        }

        internal static InstallOutcome UninstallOwned(string bundle)
        {
            BundleInfo info = BundleReader.Inspect(bundle);
            using (var mutex = new System.Threading.Mutex(false, "Local\\IWXA.SetupCore." + info.Id))
            {
                if (!mutex.WaitOne(0)) throw new InvalidOperationException("SETUP_INSTALL_ALREADY_RUNNING");
                try { return UninstallLocked(info); }
                finally { mutex.ReleaseMutex(); }
            }
        }

        private static InstallOutcome UninstallLocked(BundleInfo info)
        {
            string root = RootFor(info);
            if (Directory.Exists(PreviousFor(info)) || File.Exists(PreviousFor(info)))
                throw new InvalidOperationException("SETUP_UPGRADE_PENDING_RESOLUTION");
            // A crash can happen after the ownership receipt has been
            // removed but before the final HKCU authority key is deleted.
            // Complete that narrow, verified phase without touching user data.
            if (!File.Exists(Path.Combine(root, ReceiptFile)))
                return FinishPendingUninstall(info, root);
            IDictionary<string, object> receipt = ReadReceipt(root);
            if ((string)receipt["product"] != info.Id ||
                (string)receipt["packageSha256"] != info.PackageSha256 ||
                (string)receipt["version"] != info.Version ||
                !SamePath((string)receipt["installRoot"], root))
                throw new InvalidOperationException("SETUP_OWNERSHIP_MISMATCH");

            using (var reg = Registry.CurrentUser.OpenSubKey(RegistryProducts + info.Id))
            {
                if (reg == null ||
                    !SamePath(Convert.ToString(reg.GetValue("InstallLocation")), root) ||
                    Convert.ToString(reg.GetValue("PackageSha256")) != info.PackageSha256 ||
                    Convert.ToString(reg.GetValue("Version")) != info.Version)
                    throw new InvalidOperationException("SETUP_INSTALL_AUTHORITY_MISSING");
            }
            string app = Path.Combine(root,
                info.Entrypoint.Replace('/', Path.DirectorySeparatorChar));
            foreach (Process proc in Process.GetProcessesByName(
                Path.GetFileNameWithoutExtension(info.Entrypoint)))
            {
                try
                {
                    if (!proc.HasExited && SamePath(proc.MainModule.FileName, app))
                        throw new InvalidOperationException("SETUP_APP_STILL_RUNNING");
                }
                catch (System.ComponentModel.Win32Exception) { }
                catch (InvalidOperationException ex)
                {
                    if (ex.Message == "SETUP_APP_STILL_RUNNING") throw;
                }
                finally { proc.Dispose(); }
            }

            if (receipt.ContainsKey("legacyHandoff"))
            {
                var handoff = receipt["legacyHandoff"] as IDictionary<string, object>;
                if (handoff == null || Convert.ToString(handoff["status"]) !=
                    "PREVIEW_ONLY_NSIS_RETAINED")
                    throw new InvalidOperationException(
                        "SETUP_LEGACY_RESTORE_DEFAULT_BEFORE_UNINSTALL");
            }
            var rows = receipt["files"] as IList;
            if (rows == null || rows.Count == 0 || rows.Count > 10000)
                throw new InvalidDataException("SETUP_RECEIPT_FILES_INVALID");
            var files = new List<string>();
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (object value in rows)
            {
                string relative = value as string;
                if (relative == null) throw new InvalidDataException("SETUP_RECEIPT_FILE_INVALID");
                relative = BundleReader.SafePath(relative);
                if (!seen.Add(relative))
                    throw new InvalidDataException("SETUP_RECEIPT_DUPLICATE_FILE");
                string file = Path.GetFullPath(Path.Combine(root,
                    relative.Replace('/', Path.DirectorySeparatorChar)));
                if (!file.StartsWith(root + Path.DirectorySeparatorChar,
                    StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("SETUP_RECEIPT_ROOT_ESCAPE");
                files.Add(file);
            }
            // Preflight ALL managed targets before the first destructive step.
            RequireUninstallTargetsReady(root, files);
            // The existing HKCU owner remains the final authority until all
            // managed files and the receipt are gone. Restarting the original
            // verified Setup EXE can resume after any filesystem interruption.
            using (var writable = Registry.CurrentUser.OpenSubKey(
                RegistryProducts + info.Id, true))
            {
                if (writable == null)
                    throw new InvalidOperationException("SETUP_INSTALL_AUTHORITY_MISSING");
                writable.SetValue("UninstallPending", 1, RegistryValueKind.DWord);
            }
            bool removedFirstFile = false;
            string ownedUninstaller = Path.Combine(root, UninstallExe);
            foreach (string file in files)
            {
                // Keep the full signed V2 uninstaller and the receipt until
                // the payload is gone. No user-created file is enumerated here.
                if (SamePath(file, ownedUninstaller)) continue;
                if (!File.Exists(file)) continue;
                if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException("SETUP_UNINSTALL_LINK_FORBIDDEN");
                File.Delete(file);
                if (!removedFirstFile)
                {
                    removedFirstFile = true;
                    TestUninstallFailure(info, "after-first-payload");
                }
            }
            if (File.Exists(ownedUninstaller))
                File.Delete(ownedUninstaller);
            // A staged NSIS migration never owns the old Start Menu entry.
            if (!receipt.ContainsKey("legacyHandoff")) DeleteShortcut(info);
            DeleteStartupShortcut(info, root);
            // Delete Windows uninstall registration first, not the private
            // ownership key. Its absence is harmless when retrying.
            Registry.CurrentUser.DeleteSubKeyTree(WindowsUninstall + info.Id, false);
            TestUninstallFailure(info, "after-windows-registration");
            DeleteEmptyUninstallDirectories(root);
            File.Delete(Path.Combine(root, ReceiptFile));
            TestUninstallFailure(info, "after-receipt");
            if (Directory.Exists(root) &&
                Directory.GetFileSystemEntries(root).Length == 0)
                Directory.Delete(root);
            // Last destructive step; a crash before this is resumable from
            // UninstallPending even if the receipt was already removed.
            Registry.CurrentUser.DeleteSubKeyTree(RegistryProducts + info.Id, false);
            return new InstallOutcome {
                Status = "UNINSTALLED_USER_DATA_PRESERVED",
                Product = info.Id, Version = info.Version, Root = root
            };
        }

        private static void TestUninstallFailure(BundleInfo info, string phase)
        {
            // Test-only fixture; never enabled for any shipped IWXA product.
            if (info.Id == "iwxa.setup.fastfixture" &&
                Environment.GetEnvironmentVariable(
                    "IWXA_SETUP_TEST_UNINSTALL_FAIL_AT") == phase)
                throw new IOException("SETUP_TEST_UNINSTALL_FAILURE_" + phase);
        }

        private static void DeleteEmptyUninstallDirectories(string root)
        {
            if (!Directory.Exists(root)) return;
            var directories = new List<string>();
            var pending = new Stack<string>();
            pending.Push(root);
            while (pending.Count > 0)
            {
                string parent = pending.Pop();
                foreach (string child in Directory.GetDirectories(parent))
                {
                    if ((File.GetAttributes(child) & FileAttributes.ReparsePoint) != 0)
                        continue;
                    directories.Add(child);
                    pending.Push(child);
                }
            }
            directories.Sort((a, b) => b.Length.CompareTo(a.Length));
            foreach (string dir in directories)
                if (Directory.GetFileSystemEntries(dir).Length == 0)
                    Directory.Delete(dir);
        }

        private static InstallOutcome FinishPendingUninstall(
            BundleInfo info, string root)
        {
            using (var owner = Registry.CurrentUser.OpenSubKey(
                RegistryProducts + info.Id))
            {
                if (owner == null ||
                    Convert.ToInt32(owner.GetValue("UninstallPending", 0)) != 1 ||
                    !SamePath(Convert.ToString(owner.GetValue("InstallLocation")), root) ||
                    Convert.ToString(owner.GetValue("Version")) != info.Version ||
                    Convert.ToString(owner.GetValue("PackageSha256")) != info.PackageSha256)
                    throw new InvalidOperationException(
                        "SETUP_UNINSTALL_RESUME_AUTHORITY_MISSING");
            }
            if (File.Exists(Path.Combine(root, UninstallExe)) ||
                File.Exists(Path.Combine(root,
                    info.Entrypoint.Replace('/', Path.DirectorySeparatorChar))) ||
                File.Exists(Path.Combine(root, ReceiptFile)))
                throw new InvalidOperationException(
                    "SETUP_UNINSTALL_RESUME_MANAGED_FILES_REMAIN");
            DeleteShortcut(info);
            DeleteStartupShortcut(info, root);
            DeleteEmptyUninstallDirectories(root);
            if (Directory.Exists(root) &&
                Directory.GetFileSystemEntries(root).Length == 0)
                Directory.Delete(root);
            Registry.CurrentUser.DeleteSubKeyTree(WindowsUninstall + info.Id, false);
            Registry.CurrentUser.DeleteSubKeyTree(RegistryProducts + info.Id, false);
            return new InstallOutcome {
                Status = "UNINSTALLED_USER_DATA_PRESERVED",
                Product = info.Id, Version = info.Version, Root = root
            };
        }

        internal static void VerifyInstalledState(BundleInfo expected)
        {
            string root = RootFor(expected);
            BundleInfo current = ReadOwnedRelease(root, root, expected.Id);
            if (current.Id != expected.Id)
                throw new InvalidOperationException(
                    "SETUP_POST_OWNED_PRODUCT_MISMATCH");
            RequireRegistryOwnership(expected.Id, root, current);
            RequireOnlyOwnedFiles(root);
        }

        internal static void VerifyUninstalledState(BundleInfo expected)
        {
            string root = RootFor(expected);
            using (var owned = Registry.CurrentUser.OpenSubKey(
                RegistryProducts + expected.Id))
            using (var uninstall = Registry.CurrentUser.OpenSubKey(
                WindowsUninstall + expected.Id))
            {
                if (owned != null || uninstall != null)
                    throw new InvalidOperationException(
                        "SETUP_POST_UNINSTALL_REGISTRY_REMAINS");
            }
            if (File.Exists(Path.Combine(root, ReceiptFile)) ||
                File.Exists(Path.Combine(root, UninstallExe)) ||
                File.Exists(Path.Combine(root,
                    expected.Entrypoint.Replace('/', Path.DirectorySeparatorChar))))
                throw new InvalidOperationException(
                    "SETUP_POST_UNINSTALL_MANAGED_FILES_REMAIN");
        }

        private static void RequireUninstallTargetsReady(
            string root, IList<string> files)
        {
            if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("SETUP_UNINSTALL_ROOT_LINK_FORBIDDEN");
            foreach (string file in files)
            {
                string parent = Path.GetDirectoryName(file);
                while (!String.IsNullOrEmpty(parent) && !SamePath(parent, root))
                {
                    if (Directory.Exists(parent))
                    {
                        if ((File.GetAttributes(parent) & FileAttributes.ReparsePoint) != 0)
                            throw new InvalidDataException(
                                "SETUP_UNINSTALL_PARENT_LINK_FORBIDDEN");
                    }
                    else if (File.Exists(parent))
                        throw new InvalidDataException(
                            "SETUP_UNINSTALL_PARENT_NOT_DIRECTORY");
                    parent = Path.GetDirectoryName(parent);
                }
                if (Directory.Exists(file))
                    throw new InvalidDataException(
                        "SETUP_UNINSTALL_OWNED_FILE_REPLACED_BY_DIRECTORY");
                if (!File.Exists(file)) continue;
                FileAttributes flags = File.GetAttributes(file);
                if ((flags & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException("SETUP_UNINSTALL_LINK_FORBIDDEN");
                if ((flags & FileAttributes.ReadOnly) != 0)
                    throw new InvalidOperationException(
                        "SETUP_UNINSTALL_READONLY_FILE");
            }
        }

        internal static void LaunchUninstallerFromInstalledCopy(string executable)
        {
            LaunchUninstallerFromInstalledCopy(executable, 0);
        }

        internal static void LaunchUninstallerFromInstalledCopy(
            string executable, int removalMask)
        {
            BundleInfo info = BundleReader.Inspect(executable);
            // Check availability before spawning a worker. The temp process
            // independently repeats this validation before deleting anything.
            ResolveRemovalTargets(info, removalMask);
            string root = RootFor(info);
            if (!SamePath(Path.GetDirectoryName(executable), root))
                throw new InvalidOperationException("SETUP_UNINSTALL_WRONG_EXECUTABLE");
            ReadReceipt(root);
            string worker = Path.Combine(Path.GetTempPath(),
                "iwxa-uninstall-" + Guid.NewGuid().ToString("N") + ".exe");
            File.Copy(executable, worker);
            try
            {
                var start = new ProcessStartInfo(worker,
                    "--uninstall-worker " + Process.GetCurrentProcess().Id +
                    " " + removalMask) {
                    UseShellExecute = false, WorkingDirectory = Path.GetTempPath()
                };
                using (Process process = Process.Start(start))
                {
                    if (process == null)
                        throw new InvalidOperationException("SETUP_UNINSTALL_WORKER_FAILED");
                }
            }
            catch
            {
                // Failed launch is the only case where the parent process can
                // safely delete the private temporary copy itself.
                try { File.Delete(worker); }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
                throw;
            }
        }

        internal static InstallOutcome UninstallFromWorker(string exe, int parentId)
        {
            return UninstallFromWorker(exe, parentId, 0);
        }

        internal static InstallOutcome UninstallFromWorker(
            string exe, int parentId, int removalMask)
        {
            try
            {
                using (Process parent = Process.GetProcessById(parentId))
                    if (!parent.WaitForExit(30000))
                        throw new InvalidOperationException("SETUP_UNINSTALL_PARENT_STILL_RUNNING");
            }
            catch (ArgumentException) { }
            BundleInfo info = BundleReader.Inspect(exe);
            string[] targets = ResolveRemovalTargets(info, removalMask);
            // Verify every selected tree BEFORE the existing uninstaller
            // removes the application; never discover an unsafe junction
            // halfway through optional cleanup.
            foreach (string target in targets)
                if (!String.IsNullOrWhiteSpace(target) &&
                    Directory.Exists(target))
                    RequireRemovalTreeUnlinked(target);
            // Preserve the established owned-file uninstall path. Optional
            // data removal only begins AFTER the application is gone.
            InstallOutcome result = UninstallOwned(exe);
            bool anyRemoved = false;
            try
            {
                foreach (string target in targets)
                {
                    if (String.IsNullOrWhiteSpace(target) || !Directory.Exists(target))
                        continue;
                    RequireRemovalTreeUnlinked(target);
                    Directory.Delete(target, true);
                    anyRemoved = true;
                }
            }
            catch (Exception ex)
            {
                if (ex is IOException || ex is UnauthorizedAccessException ||
                    ex is InvalidDataException || ex is ArgumentException)
                    throw new InvalidOperationException(
                        "SETUP_UNINSTALL_DATA_CLEANUP_INCOMPLETE", ex);
                throw;
            }
            if (anyRemoved)
                result.Status = "UNINSTALLED_SELECTED_STORAGE_REMOVED";
            return result;
        }

        // Categories mirror the installed product's four registered roots.
        // Windows Programs & Features uses mask=0 and always keeps all data.
        // Never accept an arbitrary path from a caller as a cleanup target.
        internal static string CleanupBlockReason(BundleInfo info, int category)
        {
            if (category != 1 && category != 2 &&
                category != 4 && category != 8)
                return "SETUP_UNINSTALL_CATEGORY_INVALID";
            try
            {
                ResolveRemovalTargets(info, category);
                return "";
            }
            catch (InvalidOperationException ex) { return ex.Message; }
            catch (InvalidDataException ex) { return ex.Message; }
            catch (IOException ex) { return ex.Message; }
            catch (UnauthorizedAccessException ex) { return ex.Message; }
        }

        private static string[] ResolveRemovalTargets(
            BundleInfo info, int removalMask)
        {
            if (removalMask < 0 || (removalMask & ~15) != 0)
                throw new InvalidOperationException(
                    "SETUP_UNINSTALL_SELECTION_INVALID");
            if (removalMask == 0) return new string[0];
            SetupLocations locations = InstalledLocations(info);
            string app = RootFor(info);
            string[] candidates = {locations.DataRoot, locations.SoftwareRoot,
                locations.ModelsRoot, locations.CacheRoot};
            string[] targets = new string[4];
            var chosen = new List<string>();
            string shared = Path.Combine(Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData), "IWXA");
            using (var products = Registry.CurrentUser.OpenSubKey(RegistryProducts))
            {
                for (int index = 0; index < 4; index++)
                {
                    if ((removalMask & (1 << index)) == 0) continue;
                    string path = ValidateInstallRoot(candidates[index]);
                    if (PathOverlap(path, app))
                        throw new InvalidOperationException(
                            "SETUP_UNINSTALL_STORAGE_APP_OVERLAP");
                    // Never erase a user profile, Windows library or their
                    // ancestor even if a corrupt registry value points there.
                    foreach (Environment.SpecialFolder protectedFolder in new [] {
                        Environment.SpecialFolder.UserProfile,
                        Environment.SpecialFolder.LocalApplicationData,
                        Environment.SpecialFolder.ApplicationData,
                        Environment.SpecialFolder.DesktopDirectory,
                        Environment.SpecialFolder.MyDocuments,
                        Environment.SpecialFolder.CommonApplicationData,
                        Environment.SpecialFolder.CommonDocuments
                    })
                    {
                        string protectedRoot =
                            Environment.GetFolderPath(protectedFolder);
                        if (!String.IsNullOrWhiteSpace(protectedRoot) &&
                            (SamePath(path, protectedRoot) ||
                             protectedRoot.StartsWith(
                                path + Path.DirectorySeparatorChar,
                                StringComparison.OrdinalIgnoreCase)))
                            throw new InvalidOperationException(
                                "SETUP_UNINSTALL_USER_FOLDER_PROTECTED");
                    }
                    // Shared IWXA locations, including their ancestors, do
                    // not belong to a single product. Only product-namespaced
                    // subfolders can be explicitly removed.
                    if (PathOverlap(path, shared))
                    {
                        string prefix = shared + Path.DirectorySeparatorChar +
                            info.Id + Path.DirectorySeparatorChar;
                        if (!path.StartsWith(prefix,
                                StringComparison.OrdinalIgnoreCase))
                            throw new InvalidOperationException(
                                "SETUP_UNINSTALL_SHARED_STORAGE_PROTECTED");
                    }
                    if (Directory.Exists(path) &&
                        (File.GetAttributes(path) &
                            FileAttributes.ReparsePoint) != 0)
                        throw new InvalidDataException(
                            "SETUP_UNINSTALL_STORAGE_LINK_FORBIDDEN");
                    foreach (string earlier in chosen)
                        if (PathOverlap(path, earlier))
                            throw new InvalidOperationException(
                                "SETUP_UNINSTALL_STORAGE_PATHS_OVERLAP");
                    if (products != null)
                    {
                        foreach (string productId in products.GetSubKeyNames())
                        {
                            if (String.Equals(productId, info.Id,
                                    StringComparison.OrdinalIgnoreCase))
                                continue;
                            using (var other = products.OpenSubKey(productId))
                            {
                                if (other == null) continue;
                                foreach (string name in new [] {
                                    "InstallLocation", "DataLocation",
                                    "SoftwareLocation", "ModelsLocation",
                                    "CacheLocation"
                                })
                                {
                                    string otherRoot = Convert.ToString(
                                        other.GetValue(name));
                                    if (String.IsNullOrWhiteSpace(otherRoot))
                                        continue;
                                    string resolved = Path.GetFullPath(otherRoot);
                                    if (PathOverlap(path, resolved))
                                        throw new InvalidOperationException(
                                            "SETUP_UNINSTALL_OTHER_PRODUCT_STORAGE");
                                }
                            }
                        }
                    }
                    if (!IsStorageVolumeReady(Path.GetPathRoot(path)))
                        throw new InvalidOperationException(
                            "SETUP_UNINSTALL_STORAGE_VOLUME_UNAVAILABLE");
                    // A full file scan runs only in the uninstall worker,
                    // not in the user-facing confirmation dialog.
                    chosen.Add(path);
                    targets[index] = path;
                }
            }
            return targets;
        }

        private static void RequireRemovalTreeUnlinked(string root)
        {
            if (!Directory.Exists(root)) return;
            var pending = new Stack<string>();
            pending.Push(root);
            while (pending.Count > 0)
            {
                string current = pending.Pop();
                if ((File.GetAttributes(current) &
                        FileAttributes.ReparsePoint) != 0)
                    throw new InvalidDataException(
                        "SETUP_UNINSTALL_STORAGE_LINK_FORBIDDEN");
                foreach (string child in Directory.GetDirectories(current))
                    pending.Push(child);
                foreach (string file in Directory.GetFiles(current))
                    if ((File.GetAttributes(file) &
                            FileAttributes.ReparsePoint) != 0)
                        throw new InvalidDataException(
                            "SETUP_UNINSTALL_STORAGE_LINK_FORBIDDEN");
            }
        }

        // The running EXE cannot delete itself. Launch one short-lived,
        // hidden system PowerShell process to remove ONLY this exact owned
        // temp worker after it exits. No service, scheduled task, or sweep
        // of unrelated %TEMP% files is used.
        internal static void QueueOwnedUninstallWorkerCleanup(
            string executable, int exitingPid)
        {
            if (exitingPid <= 0 || String.IsNullOrWhiteSpace(executable))
                throw new InvalidOperationException("SETUP_UNINSTALL_CLEANUP_INVALID_INPUT");
            string path = Path.GetFullPath(executable);
            string temp = Path.GetFullPath(Path.GetTempPath());
            string name = Path.GetFileName(path);
            if (!SamePath(Path.GetDirectoryName(path), temp) ||
                !Regex.IsMatch(name, @"\Aiwxa-uninstall-[a-f0-9]{32}\.exe\z",
                    RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
                throw new InvalidOperationException("SETUP_UNINSTALL_CLEANUP_NOT_OWNED");
            // The expected bytes are measured before the helper starts.
            // If the file is replaced while waiting, leave it untouched.
            string expected = FingerprintLegacyFile(path);
            string quoted = path.Replace("'", "''");
            string script =
                "$ErrorActionPreference='Stop';" +
                "$file='" + quoted + "';" +
                "$hash='" + expected + "';" +
                "$workerPid=" + exitingPid + ";" +
                "for($i=0;$i -lt 80;$i++){" +
                "if(-not (Get-Process -Id $workerPid -ErrorAction SilentlyContinue)){break};" +
                "Start-Sleep -Milliseconds 250};" +
                "if(Get-Process -Id $workerPid -ErrorAction SilentlyContinue){exit 0};" +
                "for($i=0;$i -lt 20;$i++){" +
                "if(-not(Test-Path -LiteralPath $file -PathType Leaf)){break};" +
                "$item=Get-Item -LiteralPath $file -Force;" +
                "if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){break};" +
                "if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash){break};" +
                "try{Remove-Item -LiteralPath $file -Force -ErrorAction Stop;break}" +
                "catch [IO.IOException]{Start-Sleep -Milliseconds 250}" +
                "catch [UnauthorizedAccessException]{break}}";
            string powershell = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.System),
                @"WindowsPowerShell\v1.0\powershell.exe");
            if (!File.Exists(powershell))
                throw new InvalidOperationException("SETUP_UNINSTALL_CLEANUP_POWERSHELL_MISSING");
            string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
            var start = new ProcessStartInfo(powershell,
                "-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand " + encoded) {
                UseShellExecute = false, CreateNoWindow = true,
                WorkingDirectory = temp
            };
            using (Process helper = Process.Start(start))
            {
                if (helper == null)
                    throw new InvalidOperationException("SETUP_UNINSTALL_CLEANUP_NOT_STARTED");
            }
        }

        private static string FingerprintLegacyFile(string file)
        {
            if (String.IsNullOrWhiteSpace(file) || !File.Exists(file) ||
                (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("SETUP_LEGACY_BINARY_UNTRUSTED");
            using (var input = new FileStream(file, FileMode.Open, FileAccess.Read,
                FileShare.Read))
            using (var digest = SHA256.Create())
            {
                return BitConverter.ToString(digest.ComputeHash(input))
                    .Replace("-", "").ToLowerInvariant();
            }
        }

        private static IDictionary<string, object> ReadReceipt(string root)
        {
            string path = Path.Combine(root, ReceiptFile);
            if (!File.Exists(path))
                throw new InvalidOperationException("SETUP_OWNERSHIP_RECEIPT_MISSING");
            var json = new JavaScriptSerializer { MaxJsonLength = 2 * 1024 * 1024 };
            var result = json.DeserializeObject(File.ReadAllText(path, Encoding.UTF8))
                as IDictionary<string, object>;
            if (result == null || !result.ContainsKey("schema") ||
                Convert.ToString(result["schema"]) != "IWXA_SETUP_OWNERSHIP/1")
                throw new InvalidDataException("SETUP_OWNERSHIP_RECEIPT_INVALID");
            return result;
        }

        private static void Register(BundleInfo info, string root)
        {
            using (var reg = Registry.CurrentUser.CreateSubKey(RegistryProducts + info.Id))
            {
                reg.SetValue("InstallLocation", root);
                reg.SetValue("PackageSha256", info.PackageSha256);
                reg.SetValue("Version", info.Version);
            }
            using (var reg = Registry.CurrentUser.CreateSubKey(WindowsUninstall + info.Id))
            {
                reg.SetValue("DisplayName", info.Name);
                reg.SetValue("Publisher", info.Publisher);
                reg.SetValue("DisplayVersion", info.Version);
                reg.SetValue("InstallLocation", root);
                reg.SetValue("DisplayIcon", Path.Combine(root, info.Entrypoint));
                reg.SetValue("UninstallString", "\"" + Path.Combine(root, UninstallExe) + "\" --uninstall");
                reg.SetValue("NoModify", 1, RegistryValueKind.DWord);
                reg.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        private static void Deregister(BundleInfo info, string expectedRoot)
        {
            using (var reg = Registry.CurrentUser.OpenSubKey(RegistryProducts + info.Id))
                if (reg == null ||
                    !SamePath(Convert.ToString(reg.GetValue("InstallLocation")), expectedRoot))
                    return;
            Registry.CurrentUser.DeleteSubKeyTree(WindowsUninstall + info.Id, false);
            Registry.CurrentUser.DeleteSubKeyTree(RegistryProducts + info.Id, false);
        }

        private static string ShortcutPath(BundleInfo info)
        {
            return Path.Combine(Environment.GetFolderPath(
                Environment.SpecialFolder.Programs), info.InstallDir + ".lnk");
        }

        private static string StartupShortcutPath(BundleInfo info)
        {
            return Path.Combine(Environment.GetFolderPath(
                Environment.SpecialFolder.Startup), info.InstallDir + ".lnk");
        }

        internal static bool StartupEnabled(BundleInfo info)
        {
            string shortcut = StartupShortcutPath(info);
            if (!File.Exists(shortcut) ||
                (File.GetAttributes(shortcut) & FileAttributes.ReparsePoint) != 0)
                return false;
            string root = RootFor(info);
            string app = Path.Combine(root,
                info.Entrypoint.Replace('/', Path.DirectorySeparatorChar));
            try { return SamePath(GetLegacyShortcutTarget(shortcut), app); }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
            catch (System.Runtime.InteropServices.COMException) { return false; }
        }

        // Preflight is intentionally non-mutating, so an unrelated Startup
        // shortcut is reported BEFORE copying any user data to new storage.
        internal static void EnsureStartupAvailable(BundleInfo info, bool enable)
        {
            EnsureStartupAvailable(info, RootFor(info), enable);
        }

        // Use the selected target before first installation, not the default
        // path (which may be on an entirely different drive).
        internal static void EnsureStartupAvailable(BundleInfo info,
            string targetRoot, bool enable)
        {
            if (!enable) return;
            string shortcut = StartupShortcutPath(info);
            if (!File.Exists(shortcut) && !Directory.Exists(shortcut))
                return;
            string root = ValidateInstallRoot(targetRoot);
            string app = Path.Combine(root,
                info.Entrypoint.Replace('/', Path.DirectorySeparatorChar));
            try
            {
                if (File.Exists(shortcut) &&
                    (File.GetAttributes(shortcut) & FileAttributes.ReparsePoint) == 0 &&
                    SamePath(GetLegacyShortcutTarget(shortcut), app))
                    return;
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            catch (ArgumentException) { }
            catch (System.Runtime.InteropServices.COMException) { }
            throw new InvalidOperationException("SETUP_STARTUP_SHORTCUT_CONFLICT");
        }

        internal static void UpdateStartup(BundleInfo info, bool enable)
        {
            using (var mutex = new System.Threading.Mutex(false,
                "Local\\IWXA.SetupCore." + info.Id))
            {
                if (!mutex.WaitOne(0))
                    throw new InvalidOperationException("SETUP_INSTALL_ALREADY_RUNNING");
                try
                {
                    string root = RootFor(info);
                    BundleInfo current = ReadOwnedRelease(root, root, info.Id);
                    RequireRegistryOwnership(info.Id, root, current);
                    SetStartupShortcut(info, root, enable);
                }
                finally { mutex.ReleaseMutex(); }
            }
        }

        private static void SetStartupShortcut(BundleInfo info, string root,
            bool enable)
        {
            string target = StartupShortcutPath(info);
            if (!enable) { DeleteStartupShortcut(info, root); return; }
            string app = Path.Combine(root,
                info.Entrypoint.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(target))
            {
                if ((File.GetAttributes(target) & FileAttributes.ReparsePoint) == 0 &&
                    SamePath(GetLegacyShortcutTarget(target), app))
                    return;
                throw new InvalidOperationException(
                    "SETUP_STARTUP_SHORTCUT_CONFLICT");
            }
            if (Directory.Exists(target))
                throw new InvalidOperationException(
                    "SETUP_STARTUP_SHORTCUT_CONFLICT");
            string folder = Path.GetDirectoryName(target);
            Directory.CreateDirectory(folder);
            string staged = Path.Combine(folder,
                ".iwxa-setup-" + Guid.NewGuid().ToString("N") + ".lnk");
            try
            {
                CreateShortcutAt(info, root, staged);
                if (!SamePath(GetLegacyShortcutTarget(staged), app))
                    throw new InvalidDataException(
                        "SETUP_STARTUP_SHORTCUT_STAGE_INVALID");
                File.Move(staged, target);
            }
            finally { if (File.Exists(staged)) File.Delete(staged); }
        }

        private static void DeleteStartupShortcut(BundleInfo info, string root)
        {
            string shortcut = StartupShortcutPath(info);
            if (!File.Exists(shortcut) ||
                (File.GetAttributes(shortcut) & FileAttributes.ReparsePoint) != 0)
                return;
            string app = Path.Combine(root,
                info.Entrypoint.Replace('/', Path.DirectorySeparatorChar));
            try
            {
                if (SamePath(GetLegacyShortcutTarget(shortcut), app))
                    File.Delete(shortcut);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            catch (System.Runtime.InteropServices.COMException) { }
        }

        private static void CreateShortcut(BundleInfo info, string root)
        {
            // Never let the COM Save() step overwrite an unrelated shortcut.
            // Prepare privately and claim the final filename with File.Move,
            // which fails if another process created the link concurrently.
            string target = ShortcutPath(info);
            string folder = Path.GetDirectoryName(target);
            Directory.CreateDirectory(folder);
            string staged = Path.Combine(folder,
                ".iwxa-setup-" + Guid.NewGuid().ToString("N") + ".lnk");
            try
            {
                CreateShortcutAt(info, root, staged);
                string app = Path.Combine(root,
                    info.Entrypoint.Replace('/', Path.DirectorySeparatorChar));
                if (!SamePath(GetLegacyShortcutTarget(staged), app))
                    throw new InvalidDataException(
                        "SETUP_START_MENU_SHORTCUT_STAGE_INVALID");
                File.Move(staged, target);
            }
            finally
            {
                if (File.Exists(staged)) File.Delete(staged);
            }
        }

        private static void CreateShortcutAt(BundleInfo info, string root, string path)
        {
            // Recheck immediately before the COM write: a different process
            // may have created a shortcut after the initial machine preflight.
            if (File.Exists(path) || Directory.Exists(path))
                throw new InvalidOperationException(
                    "SETUP_START_MENU_SHORTCUT_CONFLICT");
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null)
                throw new InvalidOperationException("SETUP_WINDOWS_SHORTCUT_SERVICE_MISSING");
            object shell = Activator.CreateInstance(shellType);
            object link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod,
                null, shell, new object[] { path });
            Type linkType = link.GetType();
            linkType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link,
                new object[] { Path.Combine(root, info.Entrypoint) });
            linkType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link,
                new object[] { root });
            linkType.InvokeMember("Description", BindingFlags.SetProperty, null, link,
                new object[] { info.Name });
            linkType.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, new object[0]);
        }

        private static void DeleteShortcut(BundleInfo info)
        {
            // The user may have changed the Start Menu shortcut since install.
            // Only remove it while it still opens our exact installed EXE.
            string path = ShortcutPath(info);
            try
            {
                if (!File.Exists(path) ||
                    (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                    return;
                string ownedExecutable = Path.Combine(RootFor(info),
                    info.Entrypoint.Replace('/', Path.DirectorySeparatorChar));
                if (!SamePath(GetLegacyShortcutTarget(path), ownedExecutable))
                    return;
                File.Delete(path);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
            catch (System.Runtime.InteropServices.COMException) { }
            catch (InvalidOperationException) { }
            catch (ArgumentException) { }
        }

        private static bool SamePath(string a, string b)
        {
            return !String.IsNullOrWhiteSpace(a) && !String.IsNullOrWhiteSpace(b) &&
                String.Equals(Path.GetFullPath(a).TrimEnd('\\'),
                    Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
        }
    }
}

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
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
                value.StartsWith(@"\\", StringComparison.Ordinal))
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
            using (var mutex = new System.Threading.Mutex(false, "Local\\IWXA.SetupCore." + info.Id))
            {
                if (!mutex.WaitOne(0)) throw new InvalidOperationException("SETUP_INSTALL_ALREADY_RUNNING");
                try { return InstallLocked(bundle, info); }
                finally { mutex.ReleaseMutex(); }
            }
        }

        internal static InstallOutcome InstallFresh(string bundle, string selectedRoot)
        {
            return InstallFresh(bundle, selectedRoot, false);
        }

        internal static InstallOutcome InstallFresh(string bundle,
            string selectedRoot, bool startWithWindows)
        {
            BundleInfo info = BundleReader.Inspect(bundle);
            string root = ValidateInstallRoot(selectedRoot);
            using (var mutex = new System.Threading.Mutex(false, "Local\\IWXA.SetupCore." + info.Id))
            {
                if (!mutex.WaitOne(0))
                    throw new InvalidOperationException("SETUP_INSTALL_ALREADY_RUNNING");
                try { return InstallLocked(bundle, info, null, root, startWithWindows); }
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
            bool startWithWindows = false)
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

                Directory.Move(staged, root);
                activated = true;

                Register(info, root);
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
            BundleInfo info = BundleReader.Inspect(executable);
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
                    "--uninstall-worker " + Process.GetCurrentProcess().Id) {
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
            try
            {
                using (Process parent = Process.GetProcessById(parentId))
                    if (!parent.WaitForExit(30000))
                        throw new InvalidOperationException("SETUP_UNINSTALL_PARENT_STILL_RUNNING");
            }
            catch (ArgumentException) { }
            return UninstallOwned(exe);
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
            return SamePath(GetLegacyShortcutTarget(shortcut), app);
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

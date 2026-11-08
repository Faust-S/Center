using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using Microsoft.Win32;

namespace IwxaSetup
{
    // Native-to-native S3. Existing NSIS Center is not eligible.
    // Previous release remains installed until explicit confirmation.
    internal static partial class SetupInstallation
    {
        private static string PreviousFor(BundleInfo info)
        {
            return RootFor(info) + ".iwxa-previous";
        }

        internal static InstallOutcome UpgradeOwned(string bundle)
        {
            BundleInfo candidate = BundleReader.Inspect(bundle);
            using (var mutex = new System.Threading.Mutex(false,
                "Local\\IWXA.SetupCore." + candidate.Id))
            {
                if (!mutex.WaitOne(0))
                    throw new InvalidOperationException("SETUP_INSTALL_ALREADY_RUNNING");
                try { return UpgradeLocked(bundle, candidate); }
                finally { mutex.ReleaseMutex(); }
            }
        }

        private static InstallOutcome UpgradeLocked(string bundle, BundleInfo candidate)
        {
            string root = RootFor(candidate), previous = PreviousFor(candidate);
            var proposed = new UpgradeAssessment {
                Product = candidate.Id, CandidateVersion = candidate.Version,
                InstalledVersion = "", InstallRoot = root
            };
            UpgradeAssessment plan = PlanLocked(candidate, proposed);
            if (plan.Status != "UPGRADE_CANDIDATE_NOT_ACTIVATED")
                throw new InvalidOperationException("SETUP_UPGRADE_BLOCKED_" + plan.Status);

            BundleInfo old = ReadOwnedRelease(root, root, candidate.Id);
            RequireRegistryOwnership(candidate.Id, root, old);
            RequireOnlyOwnedFiles(root);
            AssertNotRunning(old, root);
            if (Directory.Exists(previous) || File.Exists(previous))
                throw new InvalidOperationException("SETUP_UPGRADE_RECOVERY_REQUIRED");

            // Same-volume stage; each payload file is verified by BundleReader.
            string staged = root + ".iwxa-new-" + Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(staged);
            bool movedOld = false, movedNew = false;
            try
            {
                PrepareVerifiedStage(bundle, candidate, staged, root);
                ReadOwnedRelease(staged, root, candidate.Id);
                RequireOnlyOwnedFiles(staged);

                Directory.Move(root, previous);
                movedOld = true;
                Directory.Move(staged, root);
                movedNew = true;
                Register(candidate, root);
                CreateShortcut(candidate, root);
                return new InstallOutcome {
                    Status = "UPGRADED_BACKUP_RETAINED",
                    Product = candidate.Id, Version = candidate.Version, Root = root
                };
            }
            catch
            {
                if (movedOld)
                {
                    try
                    {
                        if (movedNew && Directory.Exists(root))
                            Directory.Move(root, staged);
                        if (!Directory.Exists(root) && Directory.Exists(previous))
                            Directory.Move(previous, root);
                        if (!Directory.Exists(root))
                            throw new InvalidOperationException("SETUP_UPGRADE_RECOVERY_REQUIRED");
                        Register(old, root);
                        CreateShortcut(old, root);
                    }
                    catch (Exception restoration)
                    {
                        throw new InvalidOperationException(
                            "SETUP_UPGRADE_RECOVERY_REQUIRED", restoration);
                    }
                }
                throw;
            }
            finally
            {
                if (Directory.Exists(staged) && !Directory.Exists(previous))
                    Directory.Delete(staged, true);
            }
        }

        internal static InstallOutcome RollbackOwned(string bundle)
        {
            BundleInfo candidate = BundleReader.Inspect(bundle);
            using (var mutex = new System.Threading.Mutex(false,
                "Local\\IWXA.SetupCore." + candidate.Id))
            {
                if (!mutex.WaitOne(0))
                    throw new InvalidOperationException("SETUP_INSTALL_ALREADY_RUNNING");
                try { return RollbackLocked(candidate); }
                finally { mutex.ReleaseMutex(); }
            }
        }

        // Recover only releases proven to belong to the same product.
        // NSIS installations are never adopted here.
        internal static InstallOutcome RecoverOwned(string bundle)
        {
            BundleInfo candidate = BundleReader.Inspect(bundle);
            using (var mutex = new System.Threading.Mutex(false,
                "Local\\IWXA.SetupCore." + candidate.Id))
            {
                if (!mutex.WaitOne(0))
                    throw new InvalidOperationException("SETUP_INSTALL_ALREADY_RUNNING");
                try { return RecoverLocked(candidate); }
                finally { mutex.ReleaseMutex(); }
            }
        }

        private static InstallOutcome RecoverLocked(BundleInfo candidate)
        {
            string root = RootFor(candidate), previous = PreviousFor(candidate);
            if (!Directory.Exists(previous) ||
                (File.GetAttributes(previous) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("SETUP_RECOVERY_BACKUP_MISSING");
            BundleInfo old = ReadOwnedRelease(previous, root, candidate.Id);
            RequireOnlyOwnedFiles(previous);
            bool registryOld, registryNew;
            using (var reg = Registry.CurrentUser.OpenSubKey(
                RegistryProducts + candidate.Id))
            {
                if (reg == null || !SamePath(Convert.ToString(
                    reg.GetValue("InstallLocation")), root))
                    throw new InvalidOperationException(
                        "SETUP_RECOVERY_AUTHORITY_MISSING");
                string version = Convert.ToString(reg.GetValue("Version"));
                string hash = Convert.ToString(reg.GetValue("PackageSha256"));
                registryOld = version == old.Version && hash == old.PackageSha256;
                registryNew = version == candidate.Version &&
                    hash == candidate.PackageSha256;
            }

            // Interrupted before registry commit, or after moving the original
            // root away: RollbackLocked validates ownership and restores it.
            if (registryOld)
            {
                InstallOutcome restored = RollbackLocked(candidate);
                restored.Status = "RECOVERED_PREVIOUS_RELEASE";
                return restored;
            }

            // Do not silently revert an activated, registered release.
            if (registryNew && Directory.Exists(root) &&
                (File.GetAttributes(root) & FileAttributes.ReparsePoint) == 0)
            {
                BundleInfo current = ReadOwnedRelease(root, root, candidate.Id);
                if (current.Version == candidate.Version &&
                    current.PackageSha256 == candidate.PackageSha256)
                    return new InstallOutcome {
                        Status = "UPGRADE_PENDING_CONFIRMATION",
                        Product = candidate.Id, Version = candidate.Version,
                        Root = root
                    };
            }
            throw new InvalidOperationException(
                "SETUP_RECOVERY_OWNERSHIP_MISMATCH");
        }

        private static InstallOutcome RollbackLocked(BundleInfo candidate)
        {
            string root = RootFor(candidate), previous = PreviousFor(candidate);
            if (!Directory.Exists(previous))
                throw new InvalidOperationException("SETUP_PREVIOUS_RELEASE_NOT_FOUND");
            BundleInfo old = ReadOwnedRelease(previous, root, candidate.Id);
            RequireOnlyOwnedFiles(previous);
            bool hasCurrent = Directory.Exists(root);
            if (hasCurrent)
            {
                BundleInfo current = ReadOwnedRelease(root, root, candidate.Id);
                if (current.PackageSha256 != candidate.PackageSha256)
                    throw new InvalidOperationException("SETUP_ROLLBACK_CANDIDATE_MISMATCH");
                AssertNotRunning(current, root);
            }
            using (var reg = Registry.CurrentUser.OpenSubKey(RegistryProducts + candidate.Id))
            {
                if (reg == null ||
                    !SamePath(Convert.ToString(reg.GetValue("InstallLocation")), root))
                    throw new InvalidOperationException("SETUP_ROLLBACK_AUTHORITY_MISSING");
                string hash = Convert.ToString(reg.GetValue("PackageSha256"));
                if (hash != candidate.PackageSha256 && hash != old.PackageSha256)
                    throw new InvalidOperationException("SETUP_ROLLBACK_AUTHORITY_MISMATCH");
            }

            string replaced = root + ".iwxa-rolledback-" +
                Guid.NewGuid().ToString("N");
            bool movedCurrent = false, restoredOld = false;
            try
            {
                if (hasCurrent)
                {
                    Directory.Move(root, replaced);
                    movedCurrent = true;
                }
                Directory.Move(previous, root);
                restoredOld = true;
                Register(old, root);
                CreateShortcut(old, root);
            }
            catch
            {
                if (restoredOld && Directory.Exists(root))
                    Directory.Move(root, previous);
                if (movedCurrent && Directory.Exists(replaced) &&
                    !Directory.Exists(root))
                    Directory.Move(replaced, root);
                throw;
            }

            // Unknown application-created files are quarantined, not removed.
            bool userFilesPresent = false;
            if (movedCurrent)
            {
                try { RequireOnlyOwnedFiles(replaced); }
                catch (InvalidDataException) { userFilesPresent = true; }
                if (!userFilesPresent) Directory.Delete(replaced, true);
            }
            return new InstallOutcome {
                Status = userFilesPresent ?
                    "ROLLBACK_RESTORED_USER_FILES_QUARANTINED" :
                    "ROLLBACK_RESTORED_PREVIOUS",
                Product = candidate.Id, Version = old.Version, Root = root
            };
        }

        internal static InstallOutcome ConfirmUpgrade(string bundle)
        {
            BundleInfo candidate = BundleReader.Inspect(bundle);
            using (var mutex = new System.Threading.Mutex(false,
                "Local\\IWXA.SetupCore." + candidate.Id))
            {
                if (!mutex.WaitOne(0))
                    throw new InvalidOperationException("SETUP_INSTALL_ALREADY_RUNNING");
                try { return ConfirmLocked(candidate); }
                finally { mutex.ReleaseMutex(); }
            }
        }

        private static InstallOutcome ConfirmLocked(BundleInfo candidate)
        {
            string root = RootFor(candidate), previous = PreviousFor(candidate);
            if (!Directory.Exists(previous))
                throw new InvalidOperationException("SETUP_PREVIOUS_RELEASE_NOT_FOUND");
            BundleInfo installed = ReadOwnedRelease(root, root, candidate.Id);
            if (installed.PackageSha256 != candidate.PackageSha256)
                throw new InvalidOperationException("SETUP_CONFIRM_CANDIDATE_MISMATCH");
            RequireRegistryOwnership(candidate.Id, root, installed);
            ReadOwnedRelease(previous, root, candidate.Id);
            RequireOnlyOwnedFiles(previous);

            // Calling E2E must prove launch/readback before invoking confirm.
            string retired = root + ".iwxa-confirmed-" + Guid.NewGuid().ToString("N");
            Directory.Move(previous, retired);
            Directory.Delete(retired, true);
            return new InstallOutcome {
                Status = "UPGRADE_CONFIRMED_OLD_RELEASE_REMOVED",
                Product = candidate.Id, Version = candidate.Version, Root = root
            };
        }

        private static BundleInfo ReadOwnedRelease(
            string folder, string logicalRoot, string productId)
        {
            if (!Directory.Exists(folder) ||
                (File.GetAttributes(folder) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("SETUP_OWNED_ROOT_INVALID");
            IDictionary<string, object> receipt = ReadReceipt(folder);
            string exe = Path.Combine(folder, UninstallExe);
            if (!File.Exists(exe) ||
                (File.GetAttributes(exe) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("SETUP_OWNED_UNINSTALLER_MISSING");
            BundleInfo original = BundleReader.Inspect(exe);
            if (original.Id != productId ||
                Convert.ToString(receipt["product"]) != original.Id ||
                Convert.ToString(receipt["version"]) != original.Version ||
                Convert.ToString(receipt["packageSha256"]) != original.PackageSha256 ||
                !SamePath(Convert.ToString(receipt["installRoot"]), logicalRoot) ||
                !File.Exists(Path.Combine(folder,
                    original.Entrypoint.Replace('/', Path.DirectorySeparatorChar))))
                throw new InvalidDataException("SETUP_OWNERSHIP_MISMATCH");
            return original;
        }

        private static void RequireRegistryOwnership(
            string productId, string root, BundleInfo original)
        {
            using (var reg = Registry.CurrentUser.OpenSubKey(RegistryProducts + productId))
            {
                if (reg == null ||
                    !SamePath(Convert.ToString(reg.GetValue("InstallLocation")), root) ||
                    Convert.ToString(reg.GetValue("Version")) != original.Version ||
                    Convert.ToString(reg.GetValue("PackageSha256")) !=
                        original.PackageSha256)
                    throw new InvalidOperationException("SETUP_INSTALL_AUTHORITY_MISMATCH");
            }
        }

        private static void RequireOnlyOwnedFiles(string root)
        {
            IDictionary<string, object> receipt = ReadReceipt(root);
            var entries = receipt["files"] as IList;
            if (entries == null || entries.Count == 0 || entries.Count > 10000)
                throw new InvalidDataException("SETUP_OWNED_FILES_INVALID");
            var known = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (object entry in entries)
            {
                string name = entry as string;
                if (name == null || !known.Add(BundleReader.SafePath(name)))
                    throw new InvalidDataException("SETUP_OWNED_FILES_INVALID");
            }
            known.Add(ReceiptFile);
            var actual = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var queue = new Stack<string>();
            queue.Push(root);
            string prefix = root.TrimEnd(Path.DirectorySeparatorChar) +
                Path.DirectorySeparatorChar;
            while (queue.Count > 0)
            {
                string dir = queue.Pop();
                foreach (string file in Directory.GetFiles(dir))
                {
                    if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
                        throw new InvalidDataException("SETUP_OWNED_LINK_FOUND");
                    string relative = file.Substring(prefix.Length)
                        .Replace(Path.DirectorySeparatorChar, '/');
                    if (!known.Contains(relative) || !actual.Add(relative))
                        throw new InvalidDataException("SETUP_UNOWNED_FILE_PRESENT");
                }
                foreach (string sub in Directory.GetDirectories(dir))
                {
                    if ((File.GetAttributes(sub) & FileAttributes.ReparsePoint) != 0)
                        throw new InvalidDataException("SETUP_OWNED_LINK_FOUND");
                    queue.Push(sub);
                }
            }
            if (!known.SetEquals(actual))
                throw new InvalidDataException("SETUP_OWNED_FILES_MISSING");
        }

        private static void AssertNotRunning(BundleInfo original, string root)
        {
            string target = Path.Combine(root,
                original.Entrypoint.Replace('/', Path.DirectorySeparatorChar));
            foreach (Process proc in Process.GetProcessesByName(
                Path.GetFileNameWithoutExtension(original.Entrypoint)))
            {
                try
                {
                    if (!proc.HasExited && SamePath(proc.MainModule.FileName, target))
                        throw new InvalidOperationException("SETUP_APP_STILL_RUNNING");
                }
                catch (Win32Exception)
                {
                    throw new InvalidOperationException(
                        "SETUP_CANNOT_CONFIRM_APPLICATION_CLOSED");
                }
                catch (InvalidOperationException ex)
                {
                    if (ex.Message == "SETUP_APP_STILL_RUNNING") throw;
                }
                finally { proc.Dispose(); }
            }
        }
    }
}

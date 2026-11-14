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
                try { return UpgradeLocked(bundle, candidate, false); }
                finally { mutex.ReleaseMutex(); }
            }
        }

        // Same-version Repair shares the already-qualified atomic switch and rollback.
        internal static InstallOutcome RepairOwned(string bundle)
        {
            BundleInfo candidate = BundleReader.Inspect(bundle);
            using (var mutex = new System.Threading.Mutex(false,
                "Local\\IWXA.SetupCore." + candidate.Id))
            {
                if (!mutex.WaitOne(0))
                    throw new InvalidOperationException("SETUP_INSTALL_ALREADY_RUNNING");
                try { return UpgradeLocked(bundle, candidate, true); }
                finally { mutex.ReleaseMutex(); }
            }
        }

        private static InstallOutcome UpgradeLocked(
            string bundle, BundleInfo candidate, bool repairMode)
        {
            string root = RootFor(candidate), previous = PreviousFor(candidate);
            var proposed = new UpgradeAssessment {
                Product = candidate.Id, CandidateVersion = candidate.Version,
                InstalledVersion = "", InstallRoot = root
            };
            UpgradeAssessment plan = PlanLocked(candidate, proposed);
            string required = repairMode ?
                "REPAIR_CANDIDATE_NOT_ACTIVATED" :
                "UPGRADE_CANDIDATE_NOT_ACTIVATED";
            // A failed Agent candidate can be replaced by a corrected,
            // explicitly chosen same-version package without touching the
            // independently configured Task, model or data directories.
            // Reuse the owned atomic Repair switch; no new installer engine.
            bool agentReinstall = repairMode &&
                candidate.Id == "iwxa.personal-agent" &&
                plan.Status == "SAME_VERSION_DIFFERENT_PACKAGE";
            bool interruptedAgentRepair = repairMode &&
                candidate.Id == "iwxa.personal-agent" &&
                plan.Status == "AGENT_INTERRUPTED_FILES_REINSTALL";
            if (plan.Status != required && !agentReinstall && !interruptedAgentRepair)
                throw new InvalidOperationException(
                    (repairMode ? "SETUP_REPAIR_BLOCKED_" : "SETUP_UPGRADE_BLOCKED_")
                    + plan.Status);

            BundleInfo old = interruptedAgentRepair && !Directory.Exists(root) ?
                ReadOwnedRelease(previous, root, candidate.Id, true) :
                ReadOwnedRelease(root, root, candidate.Id, repairMode);
            // Changing the entrypoint requires a separately witnessed handoff.
            // The regular upgrade/repair path deliberately never rewrites
            // Start Menu shortcuts owned or customized by the user.
            if (!String.Equals(old.Entrypoint, candidate.Entrypoint,
                StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException(
                    "SETUP_ENTRYPOINT_CHANGE_REQUIRES_EXPLICIT_MIGRATION");
            RequireRegistryOwnership(candidate.Id, root, old);
            // Repair may restore missing owned files, but never adopts
            // unexpected files, redirected paths or a different package.
            if (interruptedAgentRepair)
            {
                if (Directory.Exists(root)) RequireOnlyOwnedFiles(root, true);
                RequireOnlyOwnedFiles(previous, true);
            }
            else
                RequireOnlyOwnedFiles(root, repairMode);
            AssertNotRunning(old, root);
            if (!interruptedAgentRepair &&
                (Directory.Exists(previous) || File.Exists(previous)))
                throw new InvalidOperationException("SETUP_UPGRADE_RECOVERY_REQUIRED");

            // Reject insufficient disk before changing the registered release.
            RequireStageSpace(candidate);
            // Same-volume stage; each payload file is verified by BundleReader.
            string staged = root + ".iwxa-new-" + Guid.NewGuid().ToString("N");
            Directory.CreateDirectory(staged);
            bool movedOld = false, movedNew = false;
            bool movedDamaged = false, interruptedSuccess = false;
            string damaged = root + ".iwxa-unfinished-" +
                Guid.NewGuid().ToString("N");
            try
            {
                PrepareVerifiedStage(bundle, candidate, staged, root);
                ReadOwnedRelease(staged, root, candidate.Id);
                RequireOnlyOwnedFiles(staged);

                if (interruptedAgentRepair)
                {
                    // Keep the verified prior backup in place. Replace only
                    // the incomplete owned application directory.
                    if (Directory.Exists(root))
                    {
                        Directory.Move(root, damaged);
                        movedDamaged = true;
                    }
                }
                else
                {
                    Directory.Move(root, previous);
                    movedOld = true;
                }
                Directory.Move(staged, root);
                movedNew = true;
                Register(candidate, root);
                if (interruptedAgentRepair)
                {
                    ReadOwnedRelease(root, root, candidate.Id);
                    RequireRegistryOwnership(candidate.Id, root, candidate);
                    RequireOnlyOwnedFiles(root);
                    interruptedSuccess = true;
                }
                // Upgrade and same-version Repair preserve the existing
                // Start Menu link exactly. The owned installation root and
                // entrypoint are stable; rewriting it destroys user edits.
                return new InstallOutcome {
                    Status = repairMode ? "REPAIRED_BACKUP_RETAINED" :
                        "UPGRADED_BACKUP_RETAINED",
                    Product = candidate.Id, Version = candidate.Version, Root = root
                };
            }
            catch
            {
                if (interruptedAgentRepair)
                {
                    try
                    {
                        if (movedNew && Directory.Exists(root))
                            Directory.Move(root, staged);
                        if (movedDamaged && Directory.Exists(damaged) &&
                            !Directory.Exists(root))
                            Directory.Move(damaged, root);
                        Register(old, root);
                    }
                    catch (Exception restoration)
                    {
                        throw new InvalidOperationException(
                            "SETUP_UPGRADE_RECOVERY_REQUIRED", restoration);
                    }
                }
                else if (movedOld)
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
                        // Keep the user's existing shortcut unchanged while
                        // restoring the previous owned binary and registry.
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
                // Staging created by THIS attempt is always disposable if
                // activation never began. A stale previous-backup directory
                // must not make a failed pre-activation attempt leak another
                // .iwxa-new-* folder into the user's IWXA directory.
                if (Directory.Exists(staged) &&
                    (!movedOld || !Directory.Exists(previous)))
                    Directory.Delete(staged, true);
                // This attempt owns the displaced incomplete files. They
                // were checked against the old receipt before movement. Keep
                // the prior backup until the person confirms the new install.
                if (interruptedSuccess && movedDamaged &&
                    Directory.Exists(damaged))
                {
                    try { Directory.Delete(damaged, true); }
                    catch (IOException) { }
                    catch (UnauthorizedAccessException) { }
                }
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
                // The same installed path is restored; preserve any
                // customized or intentionally deleted Start Menu shortcut.
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
            // The person may explicitly finish a previously installed Agent
            // before using a corrected same-version package. Confirm the
            // registered active build, not an uninstalled candidate's hash.
            if (installed.PackageSha256 != candidate.PackageSha256 &&
                !(candidate.Id == "iwxa.personal-agent" &&
                  installed.Version == candidate.Version))
                throw new InvalidOperationException("SETUP_CONFIRM_CANDIDATE_MISMATCH");
            RequireRegistryOwnership(candidate.Id, root, installed);
            BundleInfo backedUp = ReadOwnedRelease(
                previous, root, candidate.Id, true);
            // A same-version repair can legitimately back up a damaged
            // installation with some files missing. Do not let this prevent
            // confirmation after the new installation has been verified.
            bool previousWasRepair = backedUp.Version == installed.Version &&
                backedUp.PackageSha256 == installed.PackageSha256;
            // Incomplete owned Agent backups can result from repairing a
            // missing launcher. No unowned files or links may be discarded.
            RequireOnlyOwnedFiles(previous,
                previousWasRepair || candidate.Id == "iwxa.personal-agent");

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
            string folder, string logicalRoot, string productId,
            bool allowMissingEntrypoint = false)
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
                !SamePath(Convert.ToString(receipt["installRoot"]), logicalRoot))
                throw new InvalidDataException("SETUP_OWNERSHIP_MISMATCH");
            string application = Path.Combine(folder,
                original.Entrypoint.Replace('/', Path.DirectorySeparatorChar));
            if (Directory.Exists(application) ||
                (!allowMissingEntrypoint && !File.Exists(application)))
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

        private static void RequireOnlyOwnedFiles(
            string root, bool allowMissingOwnedFiles = false)
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
                    {
                        var error = new InvalidDataException("SETUP_UNOWNED_FILE_PRESENT");
                        error.Data["IWXA_SETUP_UNOWNED_CATEGORY"] = UnownedFileCategory(relative);
                        throw error;
                    }
                }
                foreach (string sub in Directory.GetDirectories(dir))
                {
                    if ((File.GetAttributes(sub) & FileAttributes.ReparsePoint) != 0)
                        throw new InvalidDataException("SETUP_OWNED_LINK_FOUND");
                    queue.Push(sub);
                }
            }
            if (!actual.IsSubsetOf(known) ||
                (!allowMissingOwnedFiles && !known.SetEquals(actual)) ||
                !actual.Contains(UninstallExe) || !actual.Contains(ReceiptFile))
                throw new InvalidDataException("SETUP_OWNED_FILES_MISSING");
        }

        // Only a fixed public category is returned: never expose a package
        // path, filename, profile name or user-owned bytes in a CI receipt.
        private static string UnownedFileCategory(string relative)
        {
            string normalized = relative.Replace('\\', '/').ToLowerInvariant();
            if (normalized.Contains(".webview2/") ||
                normalized.Contains("/ebwebview/") ||
                normalized.Contains("/webview2/"))
                return "WEBVIEW2_PROFILE";
            if (normalized.EndsWith(".pyc", StringComparison.Ordinal) ||
                normalized.Contains("/__pycache__/"))
                return "PYTHON_BYTECODE";
            if (normalized.StartsWith("desktop/", StringComparison.Ordinal))
                return "DESKTOP_RUNTIME";
            if (normalized.StartsWith("runtime/", StringComparison.Ordinal) ||
                normalized.StartsWith("managed-runtime/", StringComparison.Ordinal))
                return "PYTHON_OR_MODEL_RUNTIME";
            if (normalized.StartsWith("instance/", StringComparison.Ordinal) ||
                normalized.StartsWith("logs/", StringComparison.Ordinal))
                return "APPLICATION_STATE";
            return "OTHER";
        }

        private static void AssertVisibleLauncherNotRunning(BundleInfo original, string root)
        {
            // An explicit, still-running GUI is never shut down behind the
            // user's back. A detached Core, by contrast, may be stopped by
            // the product's authenticated uninstall-stop controller.
            var launchers = new List<string> {
                Path.Combine(root, original.Entrypoint.Replace('/',
                    Path.DirectorySeparatorChar))
            };
            if (original.Id == "iwxa.personal-agent")
                launchers.Add(Path.Combine(root, "IWXA Personal Agent.exe"));
            foreach (string target in launchers)
            {
                foreach (Process proc in Process.GetProcessesByName(
                    Path.GetFileNameWithoutExtension(target)))
                {
                    try
                    {
                        if (!proc.HasExited &&
                            SamePath(proc.MainModule.FileName, target))
                            throw new InvalidOperationException(
                                "SETUP_APP_STILL_RUNNING");
                    }
                    catch (Win32Exception) { }
                    catch (InvalidOperationException ex)
                    {
                        if (ex.Message == "SETUP_APP_STILL_RUNNING") throw;
                    }
                    finally { proc.Dispose(); }
                }
            }
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
            // A product may also have a child executable that remains alive
            // after its primary GUI window closes. Never switch or relocate
            // the owned tree while such an executable is still running.
            string prefix = root.TrimEnd(Path.DirectorySeparatorChar,
                Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            int self = Process.GetCurrentProcess().Id;
            foreach (Process proc in Process.GetProcesses())
            {
                try
                {
                    if (proc.Id == self || proc.HasExited) continue;
                    string image = proc.MainModule.FileName;
                    if (!String.IsNullOrWhiteSpace(image) &&
                        image.StartsWith(prefix,
                            StringComparison.OrdinalIgnoreCase))
                        throw new InvalidOperationException(
                            "SETUP_APP_STILL_RUNNING");
                }
                catch (Win32Exception)
                {
                    // Unrelated protected processes may deny image inspection;
                    // the existing exact entrypoint check above still fails
                    // closed when its identity cannot be confirmed.
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

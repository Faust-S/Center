using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace IwxaSetup
{
    internal sealed class UpgradeAssessment
    {
        internal string Status;
        internal string Product;
        internal string CandidateVersion;
        internal string InstalledVersion;
        internal string InstallRoot;
    }

    // S3 preview: pure inspection. It does not update, migrate, or repair.
    internal static partial class SetupInstallation
    {
        internal static UpgradeAssessment PlanUpgrade(string bundle)
        {
            BundleInfo info = BundleReader.Inspect(bundle);
            var plan = new UpgradeAssessment {
                Product = info.Id, CandidateVersion = info.Version,
                InstalledVersion = "", InstallRoot = RootFor(info),
                Status = "UNDETERMINED"
            };
            using (var mutex = new System.Threading.Mutex(false,
                "Local\\IWXA.SetupCore." + info.Id))
            {
                if (!mutex.WaitOne(0))
                {
                    plan.Status = "INSTALL_OPERATION_BUSY";
                    return plan;
                }
                try { return PlanLocked(info, plan); }
                finally { mutex.ReleaseMutex(); }
            }
        }

        private static UpgradeAssessment PlanLocked(BundleInfo info, UpgradeAssessment plan)
        {
            if (!Environment.Is64BitOperatingSystem ||
                info.Architecture != "windows-x64")
            {
                plan.Status = "ARCHITECTURE_UNSUPPORTED";
                return plan;
            }
            string root = plan.InstallRoot;
            if (Directory.Exists(PreviousFor(info)) ||
                File.Exists(PreviousFor(info)))
            {
                using (var owned = Registry.CurrentUser.OpenSubKey(
                    RegistryProducts + info.Id))
                {
                    if (Directory.Exists(root) && owned != null &&
                        String.Equals(Convert.ToString(
                            owned.GetValue("PackageSha256")), info.PackageSha256,
                            StringComparison.OrdinalIgnoreCase))
                    {
                        try
                        {
                            BundleInfo current = ReadOwnedRelease(root, root, info.Id);
                            BundleInfo old = ReadOwnedRelease(
                                PreviousFor(info), root, info.Id, true);
                            // A damaged same-version backup is expected after
                            // Repair, but an incomplete previous upgrade
                            // cannot silently be treated as verified.
                            bool repairedVersion = old.Version == current.Version &&
                                old.PackageSha256 == current.PackageSha256;
                            RequireOnlyOwnedFiles(
                                PreviousFor(info), repairedVersion);
                            bool incompleteRepairBackup = false;
                            if (repairedVersion)
                            {
                                try { RequireOnlyOwnedFiles(PreviousFor(info)); }
                                catch (InvalidDataException missing)
                                {
                                    if (missing.Message != "SETUP_OWNED_FILES_MISSING")
                                        throw;
                                    incompleteRepairBackup = true;
                                }
                            }
                            plan.Status = current.PackageSha256 == info.PackageSha256 &&
                                Convert.ToString(owned.GetValue("Version")) == info.Version &&
                                old.Id == info.Id ?
                                (incompleteRepairBackup ?
                                    "REPAIR_PENDING_CONFIRMATION_NO_ROLLBACK" :
                                    "UPGRADE_PENDING_CONFIRMATION") :
                                "UPGRADE_RECOVERY_REQUIRED";
                        }
                        catch (Exception)
                        {
                            plan.Status = "UPGRADE_RECOVERY_REQUIRED";
                        }
                    }
                    else
                        plan.Status = "UPGRADE_RECOVERY_REQUIRED";
                    return plan;
                }
            }
            using (var reg = Registry.CurrentUser.OpenSubKey(RegistryProducts + info.Id))
            {
                if (reg == null)
                {
                    string state = SetupReadiness.Check(info).Status;
                    if (state == "LEGACY_INSTALLATION")
                        plan.Status = "LEGACY_MIGRATION_HOLD";
                    else if (state == "EXISTING_INSTALLATION")
                        plan.Status = "UNOWNED_INSTALL_ROOT";
                    else if (state == "READY_FOR_FIRST_INSTALL" ||
                        state == "WEBVIEW2_MISSING")
                        plan.Status = "NO_OWNED_INSTALLATION";
                    else
                        plan.Status = state;
                    return plan;
                }

                // Both ownership records and exact installed binary must agree.
                // A directory name or a registry key by itself is not authority.
                try
                {
                    if (!Directory.Exists(root) ||
                        (File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0 ||
                        !SamePath(Convert.ToString(reg.GetValue("InstallLocation")), root))
                    {
                        plan.Status = "OWNERSHIP_MISMATCH";
                        return plan;
                    }
                    IDictionary<string, object> receipt = ReadReceipt(root);
                    string oldVersion = Convert.ToString(receipt["version"]);
                    if (Convert.ToString(receipt["product"]) != info.Id ||
                        !SamePath(Convert.ToString(receipt["installRoot"]), root) ||
                        oldVersion != Convert.ToString(reg.GetValue("Version")) ||
                        Convert.ToString(receipt["packageSha256"]) !=
                            Convert.ToString(reg.GetValue("PackageSha256")) ||
                        !File.Exists(Path.Combine(root, UninstallExe)))
                    {
                        plan.Status = "OWNERSHIP_MISMATCH";
                        return plan;
                    }
                    string app = Path.Combine(root,
                        info.Entrypoint.Replace('/', Path.DirectorySeparatorChar));
                    if (!File.Exists(app))
                    {
                        // The installed EXE may be absent, but Repair is
                        // permitted ONLY for the exact same verified package.
                        // Never use this route to adopt an unrelated root,
                        // damaged receipt, symlink or legacy NSIS preview.
                        if (receipt.ContainsKey("legacyHandoff") ||
                            oldVersion != info.Version ||
                            Convert.ToString(receipt["packageSha256"]) !=
                                info.PackageSha256)
                        {
                            plan.Status = "OWNERSHIP_MISMATCH";
                            return plan;
                        }
                        BundleInfo damaged = ReadOwnedRelease(
                            root, root, info.Id, true);
                        if (!String.Equals(damaged.Entrypoint, info.Entrypoint,
                                StringComparison.OrdinalIgnoreCase) ||
                            damaged.Version != info.Version ||
                            damaged.PackageSha256 != info.PackageSha256)
                        {
                            plan.Status = "OWNERSHIP_MISMATCH";
                            return plan;
                        }
                        RequireOnlyOwnedFiles(root, true);
                        plan.InstalledVersion = oldVersion;
                        plan.Status = info.NeedsWebView2 &&
                            String.IsNullOrWhiteSpace(
                                SetupReadiness.DetectWebView2Version()) ?
                            "WEBVIEW2_MISSING" :
                            "REPAIR_CANDIDATE_NOT_ACTIVATED";
                        return plan;
                    }
                    plan.InstalledVersion = oldVersion;
                    if (receipt.ContainsKey("legacyHandoff"))
                    {
                        var handoff = receipt["legacyHandoff"] as
                            IDictionary<string, object>;
                        LegacyAssessment legacy = SetupLegacy.Inspect(info);
                        bool originalValid = handoff != null &&
                            Convert.ToString(handoff["schema"]) ==
                                "IWXA_SETUP_LEGACY_HANDOFF/1" &&
                            String.Equals(Convert.ToString(handoff["root"]),
                                legacy.Root, StringComparison.OrdinalIgnoreCase) &&
                            Convert.ToString(handoff["version"]) == legacy.Version &&
                            Convert.ToString(handoff["registryName"]) ==
                                legacy.RegistryName &&
                            Convert.ToString(handoff["uninstaller"]) ==
                                legacy.Uninstaller &&
                            legacy.Status == "LEGACY_CONFIRMED_READ_ONLY" &&
                            FingerprintLegacyFile(Path.Combine(legacy.Root,
                                info.Entrypoint.Replace('/', Path.DirectorySeparatorChar))) ==
                                Convert.ToString(handoff["applicationSha256"]) &&
                            FingerprintLegacyFile(legacy.Uninstaller) ==
                                Convert.ToString(handoff["uninstallerSha256"]);
                        if (!originalValid || oldVersion != info.Version ||
                            Convert.ToString(receipt["packageSha256"]) != info.PackageSha256)
                            plan.Status = "LEGACY_MIGRATION_REVIEW_REQUIRED";
                        else
                        {
                            string phase = Convert.ToString(handoff["status"]);
                            if (phase == "PREVIEW_ONLY_NSIS_RETAINED")
                                plan.Status = "LEGACY_MIGRATION_PENDING_GUI_READBACK";
                            else if (phase == "LEGACY_DEFAULT_ACTIVE_NSIS_PRESERVED")
                                plan.Status = LegacyShortcutMatches(info, handoff) ?
                                    "LEGACY_DEFAULT_ACTIVE_NSIS_PRESERVED" :
                                    "LEGACY_MIGRATION_REVIEW_REQUIRED";
                            else if (phase == "LEGACY_SHORTCUT_SWITCH_PENDING" ||
                                     phase == "LEGACY_SHORTCUT_RESTORE_PENDING")
                                plan.Status = "LEGACY_SWITCH_RECOVERY_REQUIRED";
                            else
                                plan.Status = "LEGACY_MIGRATION_REVIEW_REQUIRED";
                        }
                        return plan;
                    }
                }
                catch (Exception ex)
                {
                    if (ex is IOException || ex is UnauthorizedAccessException ||
                        ex is InvalidDataException || ex is InvalidOperationException ||
                        ex is KeyNotFoundException || ex is ArgumentException)
                    {
                        plan.Status = "OWNERSHIP_MISMATCH";
                        return plan;
                    }
                    throw;
                }

                foreach (Process p in Process.GetProcessesByName(
                    Path.GetFileNameWithoutExtension(info.Entrypoint)))
                {
                    try
                    {
                        if (!p.HasExited && SamePath(p.MainModule.FileName,
                            Path.Combine(root, info.Entrypoint.Replace('/',
                                Path.DirectorySeparatorChar))))
                        {
                            plan.Status = "APPLICATION_RUNNING";
                            return plan;
                        }
                    }
                    catch (System.ComponentModel.Win32Exception) { }
                    catch (InvalidOperationException) { }
                    finally { p.Dispose(); }
                }
                if (info.NeedsWebView2 &&
                    String.IsNullOrWhiteSpace(SetupReadiness.DetectWebView2Version()))
                {
                    plan.Status = "WEBVIEW2_MISSING";
                    return plan;
                }
                int order;
                try { order = CompareVersions(info.Version, plan.InstalledVersion); }
                catch (FormatException)
                {
                    plan.Status = "VERSION_UNSUPPORTED";
                    return plan;
                }
                if (order < 0) plan.Status = "DOWNGRADE_BLOCKED";
                else if (order > 0) plan.Status = "UPGRADE_CANDIDATE_NOT_ACTIVATED";
                else plan.Status = String.Equals(
                    Convert.ToString(reg.GetValue("PackageSha256")),
                    info.PackageSha256, StringComparison.OrdinalIgnoreCase) ?
                        "REPAIR_CANDIDATE_NOT_ACTIVATED" :
                        "SAME_VERSION_DIFFERENT_PACKAGE";
                return plan;
            }
        }

        private static int CompareVersions(string candidate, string previous)
        {
            const string pattern =
                @"\A(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?\z";
            Match a = Regex.Match(candidate, pattern);
            Match b = Regex.Match(previous, pattern);
            if (!a.Success || !b.Success) throw new FormatException();
            for (int i = 1; i <= 3; i++)
            {
                long x, y;
                if (!long.TryParse(a.Groups[i].Value, NumberStyles.None,
                        CultureInfo.InvariantCulture, out x) ||
                    !long.TryParse(b.Groups[i].Value, NumberStyles.None,
                        CultureInfo.InvariantCulture, out y))
                    throw new FormatException();
                if (x != y) return x.CompareTo(y);
            }
            string left = a.Groups[4].Value, right = b.Groups[4].Value;
            if (left.Length == 0) return right.Length == 0 ? 0 : 1;
            if (right.Length == 0) return -1;
            string[] ls = left.Split('.'), rs = right.Split('.');
            for (int i = 0; i < Math.Min(ls.Length, rs.Length); i++)
            {
                bool ln = Regex.IsMatch(ls[i], @"\A\d+\z");
                bool rn = Regex.IsMatch(rs[i], @"\A\d+\z");
                int order;
                if (ln && rn)
                {
                    string l = ls[i].TrimStart('0'), r = rs[i].TrimStart('0');
                    order = l.Length != r.Length ?
                        l.Length.CompareTo(r.Length) : String.CompareOrdinal(l, r);
                }
                else if (ln != rn) order = ln ? -1 : 1;
                else order = String.CompareOrdinal(ls[i], rs[i]);
                if (order != 0) return Math.Sign(order);
            }
            return ls.Length.CompareTo(rs.Length);
        }
    }
}

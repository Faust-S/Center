using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;

namespace IwxaSetup
{
    // Explicit reversible Start Menu handoff for an already staged NSIS 0.2.
    // Old NSIS bytes, user data, uninstall entry and installed directory stay
    // entirely untouched. This is NOT a final removal of NSIS or a release.
    internal static partial class SetupInstallation
    {
        private const string LegacyPreviewStatus =
            "PREVIEW_ONLY_NSIS_RETAINED";
        private const string LegacySwitchPending = "LEGACY_SHORTCUT_SWITCH_PENDING";
        private const string LegacySwitchActive = "LEGACY_DEFAULT_ACTIVE_NSIS_PRESERVED";
        private const string LegacyRestorePending = "LEGACY_SHORTCUT_RESTORE_PENDING";

        private static IDictionary<string, object> LegacyReceiptState(
            BundleInfo info, out IDictionary<string, object> receipt)
        {
            string root = RootFor(info);
            receipt = ReadReceipt(root);
            var handoff = receipt.ContainsKey("legacyHandoff") ?
                receipt["legacyHandoff"] as IDictionary<string, object> : null;
            if (handoff == null || Convert.ToString(handoff["schema"]) !=
                "IWXA_SETUP_LEGACY_HANDOFF/1")
                throw new InvalidDataException("SETUP_LEGACY_HANDOFF_RECEIPT_INVALID");
            BundleInfo installed = ReadOwnedRelease(root, root, info.Id);
            RequireRegistryOwnership(info.Id, root, installed);
            if (installed.PackageSha256 != info.PackageSha256 ||
                installed.Version != info.Version)
                throw new InvalidOperationException("SETUP_LEGACY_CANDIDATE_CHANGED");
            return handoff;
        }

        private static string GetLegacyShortcutTarget(string shortcut)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null)
                throw new InvalidOperationException("SETUP_SHORTCUT_SERVICE_MISSING");
            object shell = null, link = null;
            try
            {
                shell = Activator.CreateInstance(shellType);
                link = shellType.InvokeMember("CreateShortcut",
                    BindingFlags.InvokeMethod, null, shell, new object[] { shortcut });
                string target = Convert.ToString(link.GetType().InvokeMember(
                    "TargetPath", BindingFlags.GetProperty, null, link, new object[0]));
                return Environment.ExpandEnvironmentVariables(target);
            }
            finally
            {
                if (link != null && Marshal.IsComObject(link)) Marshal.ReleaseComObject(link);
                if (shell != null && Marshal.IsComObject(shell)) Marshal.ReleaseComObject(shell);
            }
        }

        private static string ExistingShortcutHash(string shortcut)
        {
            if (!File.Exists(shortcut)) return "";
            if ((File.GetAttributes(shortcut) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("SETUP_LEGACY_SHORTCUT_LINK_UNTRUSTED");
            return FingerprintLegacyFile(shortcut);
        }

        private static void WriteLegacyReceiptAtomic(
            string root, IDictionary<string, object> receipt)
        {
            // Temp receipt is a sibling of the owned installation. An
            // interruption never introduces unknown files inside that root.
            string temp = root + ".iwxa-handoff-" + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                byte[] serialized = new UTF8Encoding(false).GetBytes(
                    new JavaScriptSerializer { MaxJsonLength = 2 * 1024 * 1024 }
                        .Serialize(receipt) + "\n");
                using (var file = new FileStream(temp, FileMode.CreateNew,
                    FileAccess.Write, FileShare.None))
                {
                    file.Write(serialized, 0, serialized.Length);
                    file.Flush(true);
                }
                File.Replace(temp, Path.Combine(root, ReceiptFile), null);
            }
            finally
            {
                if (File.Exists(temp)) File.Delete(temp);
            }
        }

        internal static bool LegacyShortcutMatches(
            BundleInfo info, IDictionary<string, object> handoff)
        {
            try
            {
                if (Convert.ToString(handoff["shortcutPath"]) != ShortcutPath(info))
                    return false;
                string expected = Convert.ToString(handoff["switchedShortcutSha256"]);
                return expected.Length == 64 &&
                    ExistingShortcutHash(ShortcutPath(info)) == expected &&
                    SamePath(GetLegacyShortcutTarget(ShortcutPath(info)),
                        Path.Combine(RootFor(info), info.Entrypoint.Replace('/',
                            Path.DirectorySeparatorChar)));
            }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
            catch (InvalidDataException) { return false; }
            catch (ArgumentException) { return false; }
        }

        internal static InstallOutcome ActivateLegacyDefault(string bundle)
        {
            BundleInfo info = BundleReader.Inspect(bundle);
            using (var mutex = new System.Threading.Mutex(false,
                "Local\\IWXA.SetupCore." + info.Id))
            {
                if (!mutex.WaitOne(0))
                    throw new InvalidOperationException("SETUP_INSTALL_ALREADY_RUNNING");
                try
                {
                    var plan = new UpgradeAssessment {
                        InstallRoot = RootFor(info), Product = info.Id,
                        CandidateVersion = info.Version
                    };
                    PlanLocked(info, plan);
                    if (plan.Status != "LEGACY_MIGRATION_PENDING_GUI_READBACK")
                        throw new InvalidOperationException(
                            "SETUP_LEGACY_SWITCH_BLOCKED_" + plan.Status);
                    IDictionary<string, object> receipt;
                    IDictionary<string, object> handoff = LegacyReceiptState(info, out receipt);
                    string link = ShortcutPath(info);
                    string legacyApp = Path.Combine(
                        Convert.ToString(handoff["root"]),
                        info.Entrypoint.Replace('/', Path.DirectorySeparatorChar));
                    bool originalPresent = File.Exists(link);
                    byte[] original = new byte[0];
                    if (originalPresent)
                    {
                        if ((File.GetAttributes(link) & FileAttributes.ReparsePoint) != 0 ||
                            !SamePath(GetLegacyShortcutTarget(link), legacyApp))
                            throw new InvalidOperationException(
                                "SETUP_LEGACY_SHORTCUT_NOT_OWNED");
                        original = File.ReadAllBytes(link);
                        if (original.Length > 262144)
                            throw new InvalidDataException("SETUP_LEGACY_SHORTCUT_TOO_LARGE");
                    }
                    string temp = Path.Combine(Path.GetDirectoryName(link),
                        ".iwxa-shortcut-" + Guid.NewGuid().ToString("N") + ".lnk");
                    try
                    {
                        CreateShortcutAt(info, RootFor(info), temp);
                        if (!SamePath(GetLegacyShortcutTarget(temp),
                            Path.Combine(RootFor(info), info.Entrypoint.Replace('/',
                                Path.DirectorySeparatorChar))))
                            throw new InvalidDataException("SETUP_LEGACY_NEW_SHORTCUT_INVALID");
                        handoff["shortcutPath"] = link;
                        handoff["originalShortcutPresent"] = originalPresent;
                        handoff["originalShortcutBase64"] = Convert.ToBase64String(original);
                        handoff["originalShortcutSha256"] =
                            originalPresent ? ExistingShortcutHash(link) : "";
                        handoff["switchedShortcutSha256"] = ExistingShortcutHash(temp);
                        handoff["status"] = LegacySwitchPending;
                        WriteLegacyReceiptAtomic(RootFor(info), receipt);
                        if (originalPresent)
                            File.Replace(temp, link, null);
                        else
                            File.Move(temp, link);
                        handoff["status"] = LegacySwitchActive;
                        WriteLegacyReceiptAtomic(RootFor(info), receipt);
                        return new InstallOutcome {
                            Status = LegacySwitchActive, Product = info.Id,
                            Version = info.Version, Root = RootFor(info)
                        };
                    }
                    finally { if (File.Exists(temp)) File.Delete(temp); }
                }
                finally { mutex.ReleaseMutex(); }
            }
        }

        internal static InstallOutcome RestoreLegacyDefault(string bundle)
        {
            BundleInfo info = BundleReader.Inspect(bundle);
            using (var mutex = new System.Threading.Mutex(false,
                "Local\\IWXA.SetupCore." + info.Id))
            {
                if (!mutex.WaitOne(0))
                    throw new InvalidOperationException("SETUP_INSTALL_ALREADY_RUNNING");
                try
                {
                    IDictionary<string, object> receipt;
                    IDictionary<string, object> handoff = LegacyReceiptState(info, out receipt);
                    string state = Convert.ToString(handoff["status"]);
                    if (state != LegacySwitchActive &&
                        state != LegacySwitchPending &&
                        state != LegacyRestorePending)
                        throw new InvalidOperationException(
                            "SETUP_LEGACY_RESTORE_NOT_SWITCHED");
                    // Fail closed if original NSIS publisher/registration/bytes
                    // changed since the controlled preview was staged.
                    LegacyAssessment legacy = SetupLegacy.Inspect(info);
                    if (legacy.Status != "LEGACY_CONFIRMED_READ_ONLY" ||
                        Convert.ToString(handoff["root"]) != legacy.Root ||
                        Convert.ToString(handoff["registryName"]) != legacy.RegistryName ||
                        Convert.ToString(handoff["uninstaller"]) != legacy.Uninstaller ||
                        FingerprintLegacyFile(Path.Combine(legacy.Root,
                            info.Entrypoint.Replace('/', Path.DirectorySeparatorChar))) !=
                            Convert.ToString(handoff["applicationSha256"]) ||
                        FingerprintLegacyFile(legacy.Uninstaller) !=
                            Convert.ToString(handoff["uninstallerSha256"]))
                        throw new InvalidOperationException(
                            "SETUP_LEGACY_ORIGINAL_CHANGED_REVIEW_REQUIRED");

                    string link = ShortcutPath(info);
                    if (Convert.ToString(handoff["shortcutPath"]) != link)
                        throw new InvalidDataException("SETUP_LEGACY_SHORTCUT_PATH_CHANGED");
                    bool originalPresent = Convert.ToBoolean(handoff["originalShortcutPresent"]);
                    byte[] original = Convert.FromBase64String(
                        Convert.ToString(handoff["originalShortcutBase64"]));
                    string oldHash = Convert.ToString(handoff["originalShortcutSha256"]);
                    string changedHash = Convert.ToString(handoff["switchedShortcutSha256"]);
                    if (originalPresent &&
                        (original.Length == 0 || original.Length > 262144 ||
                         !SamePath(GetLegacyShortcutTargetFromBytes(original, link),
                            Path.Combine(legacy.Root, info.Entrypoint.Replace('/',
                                Path.DirectorySeparatorChar)))))
                        throw new InvalidDataException("SETUP_LEGACY_SHORTCUT_BACKUP_INVALID");
                    string current = ExistingShortcutHash(link);
                    bool switched = current.Length != 0 && current == changedHash;
                    bool alreadyRestored = current == (originalPresent ? oldHash : "");
                    if (!switched && !alreadyRestored)
                        throw new InvalidOperationException(
                            "SETUP_LEGACY_SHORTCUT_MODIFIED_REVIEW_REQUIRED");
                    handoff["status"] = LegacyRestorePending;
                    WriteLegacyReceiptAtomic(RootFor(info), receipt);
                    if (switched)
                    {
                        if (originalPresent)
                        {
                            string temp = Path.Combine(Path.GetDirectoryName(link),
                                ".iwxa-restore-" + Guid.NewGuid().ToString("N") + ".lnk");
                            try
                            {
                                File.WriteAllBytes(temp, original);
                                if (ExistingShortcutHash(temp) != oldHash)
                                    throw new InvalidDataException(
                                        "SETUP_LEGACY_SHORTCUT_BACKUP_HASH_INVALID");
                                File.Replace(temp, link, null);
                            }
                            finally { if (File.Exists(temp)) File.Delete(temp); }
                        }
                        else
                            File.Delete(link);
                    }
                    handoff["status"] = LegacyPreviewStatus;
                    foreach (string name in new[] { "shortcutPath",
                        "originalShortcutPresent", "originalShortcutBase64",
                        "originalShortcutSha256", "switchedShortcutSha256" })
                        handoff.Remove(name);
                    WriteLegacyReceiptAtomic(RootFor(info), receipt);
                    return new InstallOutcome {
                        Status = "LEGACY_DEFAULT_RESTORED_NSIS_PRESERVED",
                        Product = info.Id, Version = info.Version,
                        Root = RootFor(info)
                    };
                }
                finally { mutex.ReleaseMutex(); }
            }
        }

        private static string GetLegacyShortcutTargetFromBytes(byte[] content, string path)
        {
            // Read an original shortcut by using a private temporary .lnk.
            string temp = Path.Combine(Path.GetDirectoryName(path),
                ".iwxa-check-" + Guid.NewGuid().ToString("N") + ".lnk");
            try
            {
                File.WriteAllBytes(temp, content);
                return GetLegacyShortcutTarget(temp);
            }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }
    }
}

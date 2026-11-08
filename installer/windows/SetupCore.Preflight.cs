using System;
using System.IO;
using System.Linq;
using System.Security;
using Microsoft.Win32;

namespace IwxaSetup
{
    internal sealed class InstallPreflight
    {
        internal string Status;
        internal string WebView2Version;
    }

    internal static class SetupReadiness
    {
        private const string WebView2Guid =
            "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

        internal static InstallPreflight Check(BundleInfo info)
        {
            var result = new InstallPreflight { Status = "READY_FOR_FIRST_INSTALL",
                WebView2Version = "" };
            if (!Environment.Is64BitOperatingSystem ||
                info.Architecture != "windows-x64")
            {
                result.Status = "ARCHITECTURE_UNSUPPORTED";
                return result;
            }
            string local = Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData);
            string root = Path.Combine(local, "Programs", info.InstallDir);
            if (Directory.Exists(root + ".iwxa-previous") ||
                File.Exists(root + ".iwxa-previous"))
            {
                result.Status = "UPGRADE_RECOVERY_REQUIRED";
                return result;
            }
            string legacy = Path.Combine(local, info.InstallDir);
            // Do not replace any directory not registered as ours, including
            // the user's existing Tauri NSIS 0.2 install. S3 owns migration.
            if (Directory.Exists(root) || File.Exists(root) ||
                RegistryProductExists(info))
            {
                result.Status = "EXISTING_INSTALLATION";
                return result;
            }
            if (Directory.Exists(legacy) || File.Exists(legacy) ||
                NsIsInstalled(info.Name))
            {
                result.Status = "LEGACY_INSTALLATION";
                return result;
            }
            if (info.NeedsWebView2)
            {
                result.WebView2Version = DetectWebView2Version();
                if (result.WebView2Version.Length == 0)
                    result.Status = "WEBVIEW2_MISSING";
            }
            return result;
        }

        private static bool RegistryProductExists(BundleInfo info)
        {
            using (var key = Registry.CurrentUser.OpenSubKey(
                @"Software\IWXA\SetupCore\Products\" + info.Id))
                return key != null;
        }

        private static bool NsIsInstalled(string displayName)
        {
            using (var installed = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Uninstall"))
            {
                if (installed == null) return false;
                foreach (string name in installed.GetSubKeyNames())
                {
                    using (var entry = installed.OpenSubKey(name))
                    {
                        string value = entry == null ? null :
                            entry.GetValue("DisplayName") as string;
                        if (value != null &&
                            (String.Equals(value, displayName,
                                StringComparison.OrdinalIgnoreCase) ||
                             value.StartsWith(displayName + " ",
                                StringComparison.OrdinalIgnoreCase)))
                            return true;
                    }
                }
            }
            return false;
        }

        internal static string DetectWebView2Version()
        {
            string branch = @"Software\Microsoft\EdgeUpdate\Clients\" + WebView2Guid;
            // Microsoft publishes the machine pv in the 32-bit registry view,
            // which maps to WOW6432Node on x64 Windows. HKCU is per-user.
            foreach (RegistryHive hive in new [] {
                RegistryHive.CurrentUser, RegistryHive.LocalMachine
            })
            {
                try
                {
                    using (var baseKey = RegistryKey.OpenBaseKey(
                        hive, hive == RegistryHive.LocalMachine ?
                            RegistryView.Registry32 : RegistryView.Default))
                    using (var key = baseKey.OpenSubKey(branch))
                    {
                        string raw = key == null ? null : key.GetValue("pv") as string;
                        Version version;
                        if (!String.IsNullOrWhiteSpace(raw) &&
                            Version.TryParse(raw, out version) &&
                            version.CompareTo(new Version(0, 0, 0, 0)) > 0)
                            return raw;
                    }
                }
                catch (SecurityException) { }
                catch (UnauthorizedAccessException) { }
            }
            return "";
        }
    }

    // Read-only discovery of the original Tauri/NSIS installation.
    // No adoption, uninstall command execution or migration is performed.
    internal sealed class LegacyAssessment
    {
        internal string Status;
        internal string Product;
        internal string Root;
        internal string Version;
        internal string RegistryName;
        internal string Uninstaller;
    }

    internal static class SetupLegacy
    {
        private const string WindowsUninstall =
            @"Software\Microsoft\Windows\CurrentVersion\Uninstall";

        internal static LegacyAssessment Inspect(BundleInfo info)
        {
            string root = Path.GetFullPath(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                info.InstallDir));
            var result = new LegacyAssessment {
                Status = "LEGACY_NOT_PRESENT", Product = info.Id,
                Root = root, Version = "", RegistryName = "", Uninstaller = ""
            };
            bool exists = Directory.Exists(root);
            if (File.Exists(root) || (exists &&
                (File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0))
            {
                result.Status = "LEGACY_ROOT_UNTRUSTED_HOLD";
                return result;
            }

            var candidates = new System.Collections.Generic.List<string>();
            using (var uninstall = Registry.CurrentUser.OpenSubKey(WindowsUninstall))
            {
                if (uninstall != null)
                {
                    foreach (string name in uninstall.GetSubKeyNames())
                    {
                        // The new Setup Core uses the same product display name.
                        // It is not a second legacy NSIS installation.
                        if (String.Equals(name, "IWXA.SetupCore." + info.Id,
                                StringComparison.OrdinalIgnoreCase))
                            continue;
                        using (var entry = uninstall.OpenSubKey(name))
                        {
                            if (entry != null && String.Equals(
                                Convert.ToString(entry.GetValue("DisplayName")),
                                info.Name, StringComparison.OrdinalIgnoreCase))
                                candidates.Add(name);
                        }
                    }
                }
            }

            if (candidates.Count == 0)
            {
                result.Status = exists ?
                    "LEGACY_DIRECTORY_UNREGISTERED_HOLD" :
                    "LEGACY_NOT_PRESENT";
                return result;
            }
            if (candidates.Count != 1)
            {
                result.Status = "LEGACY_AMBIGUOUS_HOLD";
                return result;
            }
            result.RegistryName = candidates[0];
            using (var entry = Registry.CurrentUser.OpenSubKey(
                WindowsUninstall + @"\" + candidates[0]))
            {
                if (entry == null)
                {
                    result.Status = "LEGACY_REGISTRY_CHANGED_HOLD";
                    return result;
                }
                result.Version = Convert.ToString(entry.GetValue("DisplayVersion"));
                string installedAt = Unquote(Convert.ToString(
                    entry.GetValue("InstallLocation")));
                string uninstallCommand = Convert.ToString(
                    entry.GetValue("UninstallString"));
                string publisher = Convert.ToString(entry.GetValue("Publisher"));
                string uninstaller = ExtractExecutable(uninstallCommand);
                result.Uninstaller = uninstaller;
                if (!exists)
                    result.Status = "LEGACY_DIRECTORY_MISSING_HOLD";
                else if (!String.IsNullOrWhiteSpace(publisher) &&
                    !String.Equals(publisher, info.Publisher,
                        StringComparison.OrdinalIgnoreCase))
                    result.Status = "LEGACY_PUBLISHER_MISMATCH_HOLD";
                else if (!String.IsNullOrWhiteSpace(installedAt) &&
                    !SameDirectory(installedAt, root))
                    result.Status = "LEGACY_INSTALL_PATH_MISMATCH_HOLD";
                else if (String.IsNullOrWhiteSpace(result.Version) ||
                    !System.Text.RegularExpressions.Regex.IsMatch(
                        result.Version,
                        @"\A\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\z"))
                    result.Status = "LEGACY_VERSION_UNKNOWN_HOLD";
                else if (!String.Equals(uninstaller,
                    Path.Combine(root, "uninstall.exe"),
                    StringComparison.OrdinalIgnoreCase) ||
                    !File.Exists(uninstaller))
                    result.Status = "LEGACY_UNINSTALLER_MISMATCH_HOLD";
                else if (!File.Exists(Path.Combine(root,
                    info.Entrypoint.Replace('/', Path.DirectorySeparatorChar))))
                    result.Status = "LEGACY_APPLICATION_MISSING_HOLD";
                else
                    result.Status = "LEGACY_CONFIRMED_READ_ONLY";
            }
            return result;
        }

        private static string Unquote(string value)
        {
            if (String.IsNullOrWhiteSpace(value)) return "";
            string path = value.Trim();
            return path.Length > 1 && path[0] == '"' &&
                path[path.Length - 1] == '"' ?
                path.Substring(1, path.Length - 2) : path;
        }

        private static string ExtractExecutable(string command)
        {
            if (String.IsNullOrWhiteSpace(command)) return "";
            string text = command.Trim();
            if (text.StartsWith("\"", StringComparison.Ordinal))
            {
                int quote = text.IndexOf('"', 1);
                return quote > 1 ? text.Substring(1, quote - 1) : "";
            }
            int end = text.IndexOf(".exe",
                StringComparison.OrdinalIgnoreCase);
            return end >= 0 ? text.Substring(0, end + 4) : "";
        }

        private static bool SameDirectory(string a, string b)
        {
            try
            {
                return String.Equals(Path.GetFullPath(a).TrimEnd('\\'),
                    Path.GetFullPath(b).TrimEnd('\\'),
                    StringComparison.OrdinalIgnoreCase);
            }
            catch (ArgumentException) { return false; }
            catch (NotSupportedException) { return false; }
        }
    }

    internal static class StagingProbe
    {
        // All package bytes are extracted into a newly created, uniquely named
        // temporary root. No install authority, registry, shortcuts or user
        // data are touched. The same verifier/extractor serves S2 install.
        internal static BundleInfo ExtractVerifyAndClean(string executable)
        {
            string stage = Path.Combine(Path.GetTempPath(),
                "iwxa-setup-stage-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(stage);
            try
            {
                BundleInfo info = BundleReader.ExtractVerified(executable, stage);
                string app = Path.GetFullPath(Path.Combine(stage,
                    info.Entrypoint.Replace('/', Path.DirectorySeparatorChar)));
                if (!File.Exists(app))
                    throw new InvalidDataException("SETUP_STAGED_ENTRYPOINT_MISSING");
                return info;
            }
            finally
            {
                if (Directory.Exists(stage))
                    Directory.Delete(stage, true);
            }
        }
    }
}

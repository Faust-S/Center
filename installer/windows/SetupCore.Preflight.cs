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

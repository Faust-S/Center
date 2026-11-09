using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Windows Explorer and support tools must identify the installer engine,
// independently of the installed product's own version. The manifest uses
// the same 1.0 version; signing/provenance is validated in a separate gate.
[assembly: AssemblyTitle("IWXA Setup Core")]
[assembly: AssemblyProduct("IWXA Setup Core")]
[assembly: AssemblyDescription("Native universal IWXA Windows installer")]
[assembly: AssemblyCompany("IWXA")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]
[assembly: AssemblyInformationalVersion("1.0.0")]

namespace IwxaSetup
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            // A deterministic non-interactive acceptance surface. Never install
            // or modify user state during package inspection.
            if (args.Length == 2 && args[0] == "--inspect-file")
            {
                try
                {
                    BundleInfo result = BundleReader.Inspect(Application.ExecutablePath);
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "VERIFIED"}, {"product", result.Id},
                        {"version", result.Version}, {"architecture", result.Architecture},
                        {"entrypoint", result.Entrypoint},
                        {"requiresWebView2", result.NeedsWebView2},
                        {"files", result.FileCount}, {"sourceCommit", result.SourceCommit},
                        {"packageSha256", result.PackageSha256},
                        {"packageFormat", result.PackageFormat}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            // Read-only support/acceptance check for the installed release.
            // The same strict owned-file verification protects the GUI from
            // claiming success after a missing file or changed receipt.
            if (args.Length == 2 && args[0] == "--verify-installed-file")
            {
                try
                {
                    BundleInfo expected = BundleReader.Inspect(
                        Application.ExecutablePath);
                    SetupInstallation.VerifyInstalledState(expected);
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "OWNED_FILES_VERIFIED"},
                        {"product", expected.Id},
                        {"version", expected.Version}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            // Report a truthful, non-mutating capacity estimate for Windows
            // acceptance and explain insufficient disk before activation.
            if (args.Length == 2 && args[0] == "--disk-plan-file")
            {
                try
                {
                    BundleInfo info = BundleReader.Inspect(Application.ExecutablePath);
                    SetupDiskPlan plan = SetupInstallation.CheckStageSpace(info);
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", plan.Status}, {"product", info.Id},
                        {"requiredBytes", plan.RequiredBytes},
                        {"availableBytes", plan.AvailableBytes},
                        {"packageBytes", info.PackageBytes},
                        {"payloadBytes", info.PayloadBytes}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            // Verification is read-only and works on an unbundled Setup stub.
            // It is used to reject an unsigned or unrelated EXE in CI.
            if (args.Length == 3 &&
                args[0] == "--verify-webview2-installer-file")
            {
                try
                {
                    string status = SetupReadiness.VerifyWebView2Installer(args[1]);
                    WriteResult(args[2], new Dictionary<string, object> {
                        {"status", status},
                        {"file", Path.GetFileName(args[1])}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[2], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            // Standalone candidate validation is read-only and works even
            // when WebView2 Runtime is installed on the CI host.
            if (args.Length == 3 && args[0] == "--verify-webview2-standalone-file")
            {
                try
                {
                    string status =
                        SetupReadiness.VerifyWebView2StandaloneCandidate(args[1]);
                    WriteResult(args[2], new Dictionary<string, object> {
                        {"status", status}, {"file", Path.GetFileName(args[1])}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[2], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            if (args.Length == 2 && args[0] == "--legacy-inspect-file")
            {
                try
                {
                    BundleInfo info = BundleReader.Inspect(Application.ExecutablePath);
                    LegacyAssessment state = SetupLegacy.Inspect(info);
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", state.Status},
                        {"product", state.Product},
                        {"installRoot", state.Root},
                        {"installedVersion", state.Version},
                        {"registryName", state.RegistryName},
                        {"uninstaller", state.Uninstaller}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            if (args.Length == 2 && args[0] == "--preflight-file")
            {
                try
                {
                    BundleInfo info = BundleReader.Inspect(Application.ExecutablePath);
                    InstallPreflight check = SetupReadiness.Check(info);
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", check.Status},
                        {"product", info.Id},
                        {"version", info.Version},
                        {"webview2Version", check.WebView2Version},
                        {"sourceCommit", info.SourceCommit}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            if (args.Length == 2 && args[0] == "--ensure-webview2-file")
            {
                try
                {
                    BundleInfo info = BundleReader.Inspect(Application.ExecutablePath);
                    string status = info.NeedsWebView2 ?
                        SetupReadiness.EnsureWebView2Online() :
                        "WEBVIEW2_NOT_REQUIRED";
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", status},
                        {"product", info.Id},
                        {"webview2Version", SetupReadiness.DetectWebView2Version()}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            // Explicit offline dependency route for a truly clean Windows VM.
            // Never bypass package identity or installer Authenticode checks.
            if (args.Length == 3 && args[0] == "--ensure-webview2-offline-file")
            {
                try
                {
                    BundleInfo info = BundleReader.Inspect(Application.ExecutablePath);
                    string status = info.NeedsWebView2 ?
                        SetupReadiness.EnsureWebView2Offline(args[1]) :
                        "WEBVIEW2_NOT_REQUIRED";
                    WriteResult(args[2], new Dictionary<string, object> {
                        {"status", status}, {"product", info.Id},
                        {"webview2Version", SetupReadiness.DetectWebView2Version()}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[2], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            if (args.Length == 2 && args[0] == "--upgrade-plan-file")
            {
                try
                {
                    UpgradeAssessment plan = SetupInstallation.PlanUpgrade(
                        Application.ExecutablePath);
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", plan.Status}, {"product", plan.Product},
                        {"candidateVersion", plan.CandidateVersion},
                        {"installedVersion", plan.InstalledVersion},
                        {"installRoot", plan.InstallRoot}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            if (args.Length == 2 &&
                (args[0] == "--upgrade-file" ||
                 args[0] == "--repair-file" ||
                 args[0] == "--rollback-upgrade-file" ||
                 args[0] == "--confirm-upgrade-file" ||
                 args[0] == "--recover-upgrade-file"))
            {
                try
                {
                    InstallOutcome result;
                    if (args[0] == "--upgrade-file")
                        result = SetupInstallation.UpgradeOwned(Application.ExecutablePath);
                    else if (args[0] == "--rollback-upgrade-file")
                        result = SetupInstallation.RollbackOwned(Application.ExecutablePath);
                    else if (args[0] == "--repair-file")
                        result = SetupInstallation.RepairOwned(Application.ExecutablePath);
                    else if (args[0] == "--recover-upgrade-file")
                        result = SetupInstallation.RecoverOwned(Application.ExecutablePath);
                    else
                        result = SetupInstallation.ConfirmUpgrade(Application.ExecutablePath);
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", result.Status}, {"product", result.Product},
                        {"version", result.Version}, {"installRoot", result.Root}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            if (args.Length == 2 && args[0] == "--stage-test-file")
            {
                try
                {
                    BundleInfo info = StagingProbe.ExtractVerifyAndClean(
                        Application.ExecutablePath);
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "STAGED_VERIFIED"},
                        {"product", info.Id},
                        {"version", info.Version},
                        {"files", info.FileCount},
                        {"bytes", info.PayloadBytes},
                        {"packageSha256", info.PackageSha256}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            // A single product-neutral locations object, validated by the
            // same native engine used by the interactive settings dialog.
            if (args.Length == 3 && args[0] == "--install-locations-file")
            {
                try
                {
                    var parsed = new JavaScriptSerializer().DeserializeObject(
                        File.ReadAllText(args[1], Encoding.UTF8)) as IDictionary<string, object>;
                    if (parsed == null ||
                        !parsed.ContainsKey("schema") ||
                        Convert.ToString(parsed["schema"]) != "IWXA_SETUP_LOCATIONS/1")
                        throw new InvalidDataException("SETUP_LOCATIONS_SCHEMA_INVALID");
                    Func<string, string> setting = key => {
                        if (!parsed.ContainsKey(key) || !(parsed[key] is string))
                            throw new InvalidDataException("SETUP_LOCATIONS_FIELD_" + key);
                        return (string)parsed[key];
                    };
                    var chosen = new SetupLocations {
                        ProgramRoot = setting("programRoot"),
                        DataRoot = setting("dataRoot"),
                        SoftwareRoot = setting("softwareRoot"),
                        ModelsRoot = setting("modelsRoot"),
                        CacheRoot = setting("cacheRoot"),
                        StartWithWindows = parsed.ContainsKey("startWithWindows") &&
                            parsed["startWithWindows"] is bool &&
                            (bool)parsed["startWithWindows"]
                    };
                    InstallOutcome installed = SetupInstallation.InstallFresh(
                        Application.ExecutablePath, chosen);
                    WriteResult(args[2], new Dictionary<string, object> {
                        {"status", installed.Status}, {"product", installed.Product},
                        {"version", installed.Version}, {"installRoot", installed.Root}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[2], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            if (args.Length == 2 && args[0] == "--locations-file")
            {
                try
                {
                    BundleInfo info = BundleReader.Inspect(Application.ExecutablePath);
                    SetupLocations current = SetupInstallation.InstalledLocations(info);
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "LOCATIONS_VERIFIED"},
                        {"programRoot", current.ProgramRoot},
                        {"dataRoot", current.DataRoot},
                        {"softwareRoot", current.SoftwareRoot},
                        {"modelsRoot", current.ModelsRoot},
                        {"cacheRoot", current.CacheRoot},
                        {"startWithWindows", current.StartWithWindows}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            // Noninteractive acceptance of explicitly selected locations and
            // login behavior. The GUI invokes the exact same engine method.
            if (args.Length == 4 && args[0] == "--install-at-file" &&
                (args[3] == "login" || args[3] == "manual"))
            {
                try
                {
                    InstallOutcome installed = SetupInstallation.InstallFresh(
                        Application.ExecutablePath, args[1], args[3] == "login");
                    WriteResult(args[2], new Dictionary<string, object> {
                        {"status", installed.Status}, {"product", installed.Product},
                        {"version", installed.Version}, {"installRoot", installed.Root}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[2], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            if (args.Length == 3 && args[0] == "--startup-mode-file" &&
                (args[1] == "login" || args[1] == "manual"))
            {
                try
                {
                    BundleInfo info = BundleReader.Inspect(Application.ExecutablePath);
                    SetupInstallation.UpdateStartup(info, args[1] == "login");
                    WriteResult(args[2], new Dictionary<string, object> {
                        {"status", "STARTUP_PREFERENCE_APPLIED"},
                        {"startupAtLogin", SetupInstallation.StartupEnabled(info)}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[2], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            if (args.Length == 2 &&
                (args[0] == "--install-file" ||
                 args[0] == "--stage-legacy-file" ||
                 args[0] == "--activate-legacy-file" ||
                 args[0] == "--restore-legacy-file" ||
                 args[0] == "--uninstall-file"))
            {
                try
                {
                    InstallOutcome result = args[0] == "--install-file" ?
                        SetupInstallation.InstallFresh(Application.ExecutablePath) :
                        args[0] == "--stage-legacy-file" ?
                            SetupInstallation.StageLegacy(Application.ExecutablePath) :
                        args[0] == "--activate-legacy-file" ?
                            SetupInstallation.ActivateLegacyDefault(Application.ExecutablePath) :
                        args[0] == "--restore-legacy-file" ?
                            SetupInstallation.RestoreLegacyDefault(Application.ExecutablePath) :
                            SetupInstallation.UninstallOwned(Application.ExecutablePath);
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", result.Status}, {"product", result.Product},
                        {"version", result.Version}, {"installRoot", result.Root}
                    });
                    return 0;
                }
                catch (Exception ex)
                {
                    WriteResult(args[1], new Dictionary<string, object> {
                        {"status", "ERROR"}, {"reason", ex.Message}
                    });
                    return 2;
                }
            }
            if (args.Length == 1 && args[0] == "--uninstall")
            {
                try
                {
                    SetupInstallation.LaunchUninstallerFromInstalledCopy(
                        Application.ExecutablePath);
                    return 0;
                }
                catch (Exception ex)
                {
                    MessageBox.Show(ex.Message, "IWXA Setup",
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 2;
                }
            }
            if (args.Length == 2 && args[0] == "--uninstall-worker")
            {
                try
                {
                    int pid;
                    if (!Int32.TryParse(args[1], out pid) || pid <= 0)
                        return 3;
                    InstallOutcome result = SetupInstallation.UninstallFromWorker(
                        Application.ExecutablePath, pid);
                    MessageBox.Show(result.Status, "IWXA Setup",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 0;
                }
                catch (Exception ex)
                {
                    MessageBox.Show(ex.Message, "IWXA Setup",
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 2;
                }
                finally
                {
                    // The worker can only clean its exact hashed temp copy.
                    // Cleanup failure must never turn a completed uninstall
                    // into a false failure or touch any application/user data.
                    try
                    {
                        SetupInstallation.QueueOwnedUninstallWorkerCleanup(
                            Application.ExecutablePath, Process.GetCurrentProcess().Id);
                    }
                    catch (Exception)
                    {
                        // A missing/blocked Windows PowerShell helper must
                        // not falsify the already completed uninstall. The
                        // specific temporary EXE may remain for manual cleanup.
                    }
                }
            }
            if (args.Length != 0) return 3;

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
            return 0;
        }

        private static void WriteResult(string path, IDictionary<string, object> result)
        {
            try
            {
                // Only a caller-specified qualification path is written.
                // No registry, application directory or user data is touched.
                File.WriteAllText(path, new JavaScriptSerializer().Serialize(result) + "\n",
                    new UTF8Encoding(false));
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
}

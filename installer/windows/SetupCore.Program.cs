using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

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
                        {"files", result.FileCount}, {"sourceCommit", result.SourceCommit},
                        {"packageSha256", result.PackageSha256}
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
            if (args.Length == 2 &&
                (args[0] == "--install-file" || args[0] == "--uninstall-file"))
            {
                try
                {
                    InstallOutcome result = args[0] == "--install-file" ?
                        SetupInstallation.InstallFresh(Application.ExecutablePath) :
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

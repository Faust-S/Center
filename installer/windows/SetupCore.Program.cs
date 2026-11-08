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

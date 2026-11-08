using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
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

        internal static string RootFor(BundleInfo info)
        {
            return Path.GetFullPath(Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Programs", info.InstallDir));
        }

        internal static SetupDiskPlan CheckStageSpace(BundleInfo info)
        {
            // Verified unpacked bytes + a complete same-volume installer copy.
            // The existing release is moved, not copied, during upgrade.
            // Reserve 64 MiB plus 2% for NTFS metadata and extraction overhead.
            if (info.PayloadBytes <= 0 || info.PackageBytes <= 0)
                throw new InvalidDataException("SETUP_DISK_PACKAGE_SIZE_UNKNOWN");
            long required = checked(info.PayloadBytes + info.PackageBytes +
                64L * 1024 * 1024 + info.PayloadBytes / 50);
            string driveRoot = Path.GetPathRoot(RootFor(info));
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

        private static void RequireStageSpace(BundleInfo info)
        {
            SetupDiskPlan disk = CheckStageSpace(info);
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
            LegacyAssessment legacy = null)
        {
            InstallPreflight readiness = SetupReadiness.Check(info);
            if (legacy == null && readiness.Status != "READY_FOR_FIRST_INSTALL")
                throw new InvalidOperationException("SETUP_BLOCKED_" + readiness.Status);
            if (legacy != null && readiness.Status != "LEGACY_INSTALLATION")
                throw new InvalidOperationException("SETUP_LEGACY_STATE_CHANGED");
            string root = RootFor(info);
            RequireStageSpace(info);
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
                if (legacy == null) CreateShortcut(info, root);
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
                if (activated) Deregister(info, root);
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
                    Convert.ToString(reg.GetValue("PackageSha256")) != info.PackageSha256)
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
            // Fail BEFORE deleting anything when an owned file or an
            // intermediate directory is read-only or redirected. Otherwise a
            // late filesystem refusal could leave an incomplete application.
            RequireUninstallTargetsReady(root, files);
            // Only delete known installation files. Unexpected user files in
            // the install directory, user data and external programs survive.
            foreach (string file in files)
            {
                if (File.Exists(file))
                {
                    if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
                        throw new InvalidDataException("SETUP_UNINSTALL_LINK_FORBIDDEN");
                    File.Delete(file);
                }
            }
            File.Delete(Path.Combine(root, ReceiptFile));
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
            if (Directory.GetFileSystemEntries(root).Length == 0)
                Directory.Delete(root);
            // A staged NSIS migration never owns the old Start Menu entry.
            if (!receipt.ContainsKey("legacyHandoff")) DeleteShortcut(info);
            Deregister(info, root);
            return new InstallOutcome {
                Status = "UNINSTALLED_USER_DATA_PRESERVED",
                Product = info.Id, Version = info.Version, Root = root
            };
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
            var start = new ProcessStartInfo(worker,
                "--uninstall-worker " + Process.GetCurrentProcess().Id) {
                UseShellExecute = false, WorkingDirectory = Path.GetTempPath()
            };
            Process process = Process.Start(start);
            if (process == null) throw new InvalidOperationException("SETUP_UNINSTALL_WORKER_FAILED");
            process.Dispose();
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

        private static void CreateShortcut(BundleInfo info, string root)
        {
            CreateShortcutAt(info, root, ShortcutPath(info));
        }

        private static void CreateShortcutAt(BundleInfo info, string root, string path)
        {
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

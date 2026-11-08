using System;
using System.Drawing;
using System.Diagnostics;
using System.IO;
using System.Globalization;
using System.Net;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace IwxaSetup
{
    internal sealed class SetupForm : Form
    {
        private static readonly Color Dark = Color.FromArgb(31, 45, 67);
        private static readonly Color Accent = Color.FromArgb(39, 109, 243);
        private static readonly Color Secondary = Color.FromArgb(98, 115, 139);
        private readonly bool ru = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ru";
        private readonly Label productName = new Label();
        private readonly Label description = new Label();
        private readonly Label status = new Label();
        private readonly Label version = new Label();
        private readonly Label packageDetails = new Label();
        private readonly Button retry = new Button();
        private readonly Button install = new Button();
        private readonly Button secondary = new Button();
        private readonly LinkLabel openApplication = new LinkLabel();
        private enum SetupOperation { None, Install, Upgrade, Recover, Confirm, Rollback,
            StageLegacyPreview, CancelLegacyPreview, InstallWebView2,
            InstallWebView2Offline, Repair }
        private SetupOperation primaryAction = SetupOperation.None;
        private SetupOperation secondaryAction = SetupOperation.None;
        private bool performingOperation = false;

        internal SetupForm()
        {
            Text = "IWXA Setup";
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 10F);
            AutoScaleMode = AutoScaleMode.Dpi;
            MinimumSize = new Size(800, 550);
            ClientSize = new Size(900, 560);
            BackColor = Color.FromArgb(246, 249, 253);
            MaximizeBox = false;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { Icon = SystemIcons.Application; }
            BuildLayout();
            Shown += async (sender, args) => await VerifyAsync();
        }

        private string T(string russian, string english)
        {
            return ru ? russian : english;
        }

        private Label Label(string value, int x, int y, int width, int height,
                            int size, Color color, bool strong)
        {
            return new Label {
                Text = value, AutoSize = false, Location = new Point(x, y),
                Size = new Size(width, height), ForeColor = color,
                Font = new Font("Segoe UI", size, strong ? FontStyle.Bold : FontStyle.Regular)
            };
        }

        private void BuildLayout()
        {
            // A two-column container prevents DockStyle.Fill from painting
            // underneath the left navigation panel (confirmed in real CI PNG).
            var shell = new TableLayoutPanel {
                Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1,
                Margin = Padding.Empty, Padding = Padding.Empty,
                BackColor = Color.FromArgb(246, 249, 253)
            };
            shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 235F));
            shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            Controls.Add(shell);
            var sidebar = new Panel {
                Dock = DockStyle.Fill, Margin = Padding.Empty,
                BackColor = Dark, AccessibleName = "IWXA setup navigation"
            };
            shell.Controls.Add(sidebar, 0, 0);
            sidebar.Controls.Add(Label("IWXA", 27, 35, 180, 45, 27, Color.White, true));
            sidebar.Controls.Add(Label("SETUP CORE", 29, 82, 175, 22, 10,
                Color.FromArgb(170, 189, 215), false));
            sidebar.Controls.Add(Label(T("УНИВЕРСАЛЬНАЯ УСТАНОВКА", "UNIVERSAL INSTALL"),
                29, 144, 195, 42, 9, Color.FromArgb(213, 227, 242), true));
            var step = new Panel {
                Location = new Point(12, 218), Size = new Size(213, 60),
                BackColor = Color.FromArgb(53, 87, 130)
            };
            step.Controls.Add(Label(T("01  Проверка пакета", "01  Verify package"),
                12, 14, 193, 32, 10, Color.White, true));
            sidebar.Controls.Add(step);
            sidebar.Controls.Add(Label(T("02  Установка", "02  Installation"),
                26, 298, 182, 28, 10, Color.FromArgb(186, 202, 223), false));
            sidebar.Controls.Add(Label(T("03  Готовность", "03  Ready"),
                26, 344, 182, 28, 10, Color.FromArgb(186, 202, 223), false));
            var bottom = Label("IWXA  •  WINDOWS", 26, 516, 186, 28,
                9, Color.FromArgb(186, 202, 223), false);
            bottom.Anchor = AnchorStyles.Left | AnchorStyles.Bottom;
            sidebar.Controls.Add(bottom);

            var area = new Panel {
                Dock = DockStyle.Fill, Margin = Padding.Empty,
                BackColor = Color.FromArgb(246, 249, 253),
                AccessibleName = "IWXA setup content"
            };
            shell.Controls.Add(area, 1, 0);

            var eyebrow = Label(T("ДИСТРИБУТИВ IWXA", "IWXA DISTRIBUTION"),
                32, 32, 550, 25, 9, Accent, true);
            area.Controls.Add(eyebrow);
            productName.Text = T("Проверка установщика", "Checking installer");
            productName.AccessibleName = productName.Text;
            productName.Font = new Font("Segoe UI", 21, FontStyle.Bold);
            productName.ForeColor = Dark;
            productName.Location = new Point(31, 68);
            productName.Size = new Size(570, 52);
            productName.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top;
            area.Controls.Add(productName);
            description.Text = T(
                "Проверяем файлы и происхождение пакета перед изменением системы.",
                "Checking package files and source identity before any system changes.");
            description.ForeColor = Secondary;
            description.Location = new Point(33, 127);
            description.Size = new Size(560, 54);
            description.Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top;
            area.Controls.Add(description);

            var card = new Panel {
                BackColor = Color.White, Location = new Point(30, 199),
                Size = new Size(580, 197), Anchor = AnchorStyles.Top |
                    AnchorStyles.Left | AnchorStyles.Right
            };
            area.Controls.Add(card);
            card.Controls.Add(Label(T("ПАКЕТ ПРОГРАММЫ", "APPLICATION PACKAGE"),
                20, 16, 500, 25, 9, Secondary, true));
            status.Text = T("Проверка выполняется…", "Verification in progress…");
            status.Font = new Font("Segoe UI", 13, FontStyle.Bold);
            status.ForeColor = Dark;
            status.Location = new Point(20, 50);
            status.Size = new Size(525, 37);
            card.Controls.Add(status);
            version.Text = "—";
            version.ForeColor = Color.FromArgb(48, 83, 131);
            version.Location = new Point(21, 93);
            version.Size = new Size(525, 29);
            card.Controls.Add(version);
            packageDetails.Text = T("Ожидание проверки содержимого…", "Waiting for content verification…");
            packageDetails.ForeColor = Secondary;
            packageDetails.Location = new Point(21, 133);
            packageDetails.Size = new Size(530, 50);
            card.Controls.Add(packageDetails);

            var note = Label(
                T("Новая установка сохраняет личные данные и другие программы.\nПроверка пакета не изменяет установленную программу.",
                  "Fresh installation preserves user data and other applications.\nPackage inspection does not modify the installed application."),
                33, 417, 559, 51, 9, Secondary, false);
            note.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            area.Controls.Add(note);

            openApplication.Text = T("Открыть установленную программу", "Open installed application");
            openApplication.Location = new Point(32, 472);
            openApplication.Size = new Size(560, 25);
            openApplication.LinkColor = Accent;
            openApplication.Visible = false;
            openApplication.TabStop = true;
            openApplication.LinkClicked += (sender, args) => OpenRelatedAction();
            area.Controls.Add(openApplication);

            var actions = new FlowLayoutPanel {
                Dock = DockStyle.Bottom,
                Height = 67,
                FlowDirection = FlowDirection.RightToLeft,
                WrapContents = false,
                Padding = new Padding(16, 10, 16, 5),
                BackColor = Color.FromArgb(246, 249, 253)
            };
            area.Controls.Add(actions);

            install.Text = T("Установить", "Install");
            install.AccessibleName = install.Text;
            install.AccessibleDescription = T("Основное действие установщика",
                "Primary installer action");
            install.TabStop = true;
            install.Enabled = false;
            install.Size = new Size(192, 40);
            install.Margin = new Padding(5, 0, 5, 0);
            install.BackColor = Accent;
            install.ForeColor = Color.White;
            install.FlatStyle = FlatStyle.Flat;
            install.FlatAppearance.BorderSize = 0;
            install.Click += async (sender, args) => await ExecuteAsync(primaryAction);
            actions.Controls.Add(install);

            secondary.Visible = false;
            secondary.AccessibleDescription = T("Отменить обновление и вернуть предыдущую версию",
                "Cancel update and restore previous release");
            secondary.Size = new Size(160, 40);
            secondary.Margin = new Padding(5, 0, 5, 0);
            secondary.BackColor = Color.White;
            secondary.ForeColor = Color.FromArgb(39, 78, 133);
            secondary.FlatStyle = FlatStyle.Flat;
            secondary.FlatAppearance.BorderColor = Color.FromArgb(187, 205, 227);
            secondary.Click += async (sender, args) => await ExecuteAsync(secondaryAction);
            actions.Controls.Add(secondary);

            retry.Text = T("Проверить снова", "Verify again");
            retry.Size = new Size(145, 40);
            retry.Margin = new Padding(5, 0, 5, 0);
            retry.BackColor = Color.White;
            retry.FlatStyle = FlatStyle.Flat;
            retry.FlatAppearance.BorderColor = Color.FromArgb(187, 205, 227);
            retry.ForeColor = Color.FromArgb(39, 78, 133);
            retry.Click += async (sender, args) => await VerifyAsync();
            actions.Controls.Add(retry);
        }

        private void ConfigureActions(
            SetupOperation primary, SetupOperation alternate, string primaryLabel)
        {
            primaryAction = primary;
            secondaryAction = alternate;
            install.Text = primaryLabel;
            install.AccessibleName = primaryLabel;
            install.Enabled = !performingOperation && primary != SetupOperation.None;
            secondary.Visible = alternate != SetupOperation.None;
            secondary.Enabled = !performingOperation && alternate != SetupOperation.None;
            if (alternate == SetupOperation.Rollback)
                secondary.Text = T("Вернуть прежнюю", "Roll back");
            else if (alternate == SetupOperation.InstallWebView2Offline)
                secondary.Text = T("Из файла…", "From file…");
            secondary.AccessibleName = secondary.Text;
            secondary.AccessibleDescription =
                alternate == SetupOperation.InstallWebView2Offline ?
                    T("Выбрать официальный автономный установщик WebView2 на диске",
                      "Choose Microsoft's offline WebView2 installer file") :
                alternate == SetupOperation.Rollback ?
                    T("Восстановить прежнюю установленную версию",
                      "Restore the previously installed version") : "";
            secondary.TabStop = alternate != SetupOperation.None;
        }

        private void ShowDiskSpaceRequired(SetupDiskPlan disk, string versionLine)
        {
            long missingMiB = (disk.RequiredBytes - disk.AvailableBytes +
                1024 * 1024 - 1) / (1024 * 1024);
            SetState(T("Недостаточно места на диске",
                       "Not enough free disk space"),
                T("Освободите ещё примерно ", "Free approximately ") +
                missingMiB + T(" МБ и повторите проверку. Данные не изменены.",
                               " MB and verify again. No application files were changed."),
                versionLine, true);
        }

        private void SetState(
            string heading, string details, string versionLine, bool warning)
        {
            status.Text = heading;
            status.ForeColor = warning ?
                Color.FromArgb(164, 92, 29) : Color.FromArgb(24, 119, 91);
            version.Text = versionLine;
            packageDetails.Text = details;
        }

        private void OpenRelatedAction()
        {
            try
            {
                if (openApplication.Tag as string == "WEBVIEW2")
                {
                    Process.Start(new ProcessStartInfo(
                        "https://developer.microsoft.com/microsoft-edge/webview2/") {
                        UseShellExecute = true
                    });
                    return;
                }

                BundleInfo info = BundleReader.Inspect(Application.ExecutablePath);
                string root = SetupInstallation.RootFor(info);
                string exe = Path.GetFullPath(Path.Combine(
                    root, info.Entrypoint.Replace('/', Path.DirectorySeparatorChar)));
                if (!exe.StartsWith(root + Path.DirectorySeparatorChar,
                        StringComparison.OrdinalIgnoreCase) || !File.Exists(exe))
                    throw new InvalidOperationException("SETUP_INSTALLED_APP_MISSING");
                Process.Start(new ProcessStartInfo(exe) {
                    UseShellExecute = true, WorkingDirectory = root
                });
            }
            catch (Exception ex)
            {
                status.Text = T("Не удалось открыть", "Could not open");
                status.ForeColor = Color.FromArgb(170, 52, 59);
                packageDetails.Text = ex.Message;
            }
        }

        private async Task ExecuteAsync(SetupOperation operation)
        {
            if (performingOperation || operation == SetupOperation.None) return;
            string offlineInstaller = null;
            if (operation == SetupOperation.InstallWebView2Offline)
            {
                using (var select = new OpenFileDialog {
                    Title = T("Выберите автономный WebView2 Runtime",
                              "Select the offline WebView2 Runtime installer"),
                    Filter = T("Установщики Windows (*.exe)|*.exe",
                               "Windows installers (*.exe)|*.exe"),
                    Multiselect = false,
                    CheckFileExists = true
                })
                {
                    if (select.ShowDialog(this) != DialogResult.OK) return;
                    offlineInstaller = select.FileName;
                }
            }
            if (operation == SetupOperation.Confirm)
            {
                DialogResult answer = MessageBox.Show(
                    T("Вы уже запустили новую версию, проверили организации, проекты и сохранённые данные?\nПосле подтверждения предыдущая версия будет удалена.",
                      "Have you launched the new version and checked organizations, projects and saved data?\nConfirmation permanently removes the previous application version."),
                    T("Подтверждение обновления", "Confirm upgrade"),
                    MessageBoxButtons.YesNo, MessageBoxIcon.Warning,
                    MessageBoxDefaultButton.Button2);
                if (answer != DialogResult.Yes) return;
            }
            performingOperation = true;
            install.Enabled = false;
            secondary.Enabled = false;
            retry.Enabled = false;
            openApplication.Enabled = false;
            status.ForeColor = Dark;
            status.Text = operation == SetupOperation.Upgrade ?
                T("Обновление программы…", "Updating application…") :
                operation == SetupOperation.Repair ?
                T("Восстановление файлов программы…", "Repairing application files…") :
                operation == SetupOperation.Recover || operation == SetupOperation.Rollback ?
                T("Восстановление предыдущей версии…", "Restoring previous version…") :
                operation == SetupOperation.Confirm ?
                T("Завершение обновления…", "Finalizing upgrade…") :
                operation == SetupOperation.CancelLegacyPreview ?
                T("Отмена пробного перехода…", "Cancelling preview installation…") :
                operation == SetupOperation.StageLegacyPreview ?
                T("Подготовка пробной версии отдельно от прежней…",
                  "Preparing a preview beside the existing version…") :
                operation == SetupOperation.InstallWebView2 ||
                operation == SetupOperation.InstallWebView2Offline ?
                T("Установка Microsoft WebView2…",
                  "Installing Microsoft WebView2…") :
                T("Установка проверенных файлов…", "Installing verified files…");
            Exception failure = null;
            try
            {
                InstallOutcome result = await Task.Run(() =>
                {
                    string executable = Application.ExecutablePath;
                    switch (operation)
                    {
                        case SetupOperation.Install: return SetupInstallation.InstallFresh(executable);
                        case SetupOperation.Upgrade: return SetupInstallation.UpgradeOwned(executable);
                        case SetupOperation.Repair: return SetupInstallation.RepairOwned(executable);
                        case SetupOperation.Recover: return SetupInstallation.RecoverOwned(executable);
                        case SetupOperation.Rollback: return SetupInstallation.RollbackOwned(executable);
                        case SetupOperation.Confirm: return SetupInstallation.ConfirmUpgrade(executable);
                        case SetupOperation.StageLegacyPreview:
                            return SetupInstallation.StageLegacy(executable);
                        case SetupOperation.CancelLegacyPreview:
                            return SetupInstallation.UninstallOwned(executable);
                        case SetupOperation.InstallWebView2:
                        case SetupOperation.InstallWebView2Offline:
                            string componentStatus =
                                operation == SetupOperation.InstallWebView2 ?
                                    SetupReadiness.EnsureWebView2Online() :
                                    SetupReadiness.EnsureWebView2Offline(offlineInstaller);
                            return new InstallOutcome {
                                Status = componentStatus, Product = "webview2-evergreen",
                                Version = SetupReadiness.DetectWebView2Version(),
                                Root = ""
                            };
                        default: throw new InvalidOperationException("SETUP_OPERATION_UNSUPPORTED");
                    }
                });
                // Recheck on-disk ownership; the display is never advanced
                // merely because a background operation returned a status.
                performingOperation = false;
                await VerifyAsync();
                if (operation == SetupOperation.Upgrade)
                    status.Text = T("Новая версия установлена — проверьте запуск",
                        "Update installed — verify the application");
                else if (operation == SetupOperation.Repair)
                    status.Text = T("Файлы восстановлены — проверьте запуск",
                        "Files restored — verify the application");
                else if (operation == SetupOperation.Install)
                    status.Text = T("Приложение установлено", "Application installed");
                else if (operation == SetupOperation.Rollback ||
                         result.Status == "RECOVERED_PREVIOUS_RELEASE")
                    status.Text = T("Предыдущая версия восстановлена", "Previous version restored");
                else if (operation == SetupOperation.Confirm)
                    status.Text = T("Обновление завершено", "Upgrade finalized");
                else if (operation == SetupOperation.StageLegacyPreview)
                    status.Text = T("Пробная версия готова — прежняя установка сохранена",
                        "Preview ready — existing installation retained");
                else if (operation == SetupOperation.CancelLegacyPreview)
                    status.Text = T("Пробный переход отменён — прежняя установка сохранена",
                        "Preview cancelled — existing installation retained");
                else if (operation == SetupOperation.InstallWebView2 ||
                         operation == SetupOperation.InstallWebView2Offline)
                    status.Text = T("WebView2 готов — можно установить программу",
                        "WebView2 ready — application can now be installed");
                status.ForeColor = Color.FromArgb(24, 119, 91);
            }
            catch (Exception ex)
            {
                // C# 5 native compiler cannot await inside a catch block.
                failure = ex;
            }
            finally
            {
                performingOperation = false;
                retry.Enabled = true;
                openApplication.Enabled = true;
            }
            if (failure != null)
            {
                // After catch/finally, await is supported by the Windows C# 5
                // compiler. Restore actions from a fresh real machine check.
                await VerifyAsync();
                if (IsDisposed || Disposing) return;
                bool dependency = operation == SetupOperation.InstallWebView2 ||
                    operation == SetupOperation.InstallWebView2Offline;
                if (dependency)
                {
                    status.Text = T("Не удалось установить WebView2",
                        "WebView2 installation incomplete");
                    string code = failure is WebException ?
                        "SETUP_WEBVIEW2_NETWORK_UNAVAILABLE" : failure.Message;
                    if (!code.StartsWith("SETUP_WEBVIEW2_",
                            StringComparison.Ordinal) || code.Length > 90)
                        code = "SETUP_WEBVIEW2_INSTALL_UNAVAILABLE";
                    version.Text = T("Код диагностики: ", "Diagnostic code: ") + code;
                    if (failure is WebException)
                        packageDetails.Text = T(
                            "Проверьте интернет и повторите попытку либо выберите официальный автономный установщик Microsoft.",
                            "Check the connection and retry, or choose Microsoft's official offline installer.");
                    else if (code.Contains("OFFLINE_STANDALONE_REQUIRED"))
                        packageDetails.Text = T(
                            "Это маленький сетевой загрузчик. Выберите полный автономный WebView2 Runtime для Windows x64 с сайта Microsoft.",
                            "This is a small online bootstrapper. Select Microsoft's full offline WebView2 Runtime for Windows x64.");
                    else if (code.Contains("AUTHENTICODE") ||
                             code.Contains("SIGNER") ||
                             code.Contains("PRODUCT_UNEXPECTED"))
                        packageDetails.Text = T(
                            "Выбранный файл не прошёл проверку Microsoft. Скачайте официальный автономный WebView2 Runtime.",
                            "The file could not be verified as Microsoft's installer. Select the official standalone WebView2 Runtime.");
                    else
                        packageDetails.Text = T(
                            "Повторите установку или выберите автономный файл Microsoft. Приложение не изменено.",
                            "Retry or select Microsoft's offline installer. Application files were not changed.");
                }
                else if (failure.Message.StartsWith(
                    "SETUP_DISK_SPACE_INSUFFICIENT", StringComparison.Ordinal))
                {
                    status.Text = T("Недостаточно места на диске",
                        "Not enough free disk space");
                    version.Text = T("Освободите место и повторите попытку",
                        "Free disk space and try again");
                    packageDetails.Text = T(
                        "Установка не переключала версию приложения. Освободите место на диске и проверьте снова.",
                        "The existing version was not switched. Free disk space and verify again.");
                }
                else
                {
                    status.Text = T("Операция не завершена", "Operation incomplete");
                    version.Text = failure.Message;
                    packageDetails.Text = T(
                        "Проверьте состояние установки и используйте доступное действие восстановления.",
                        "Review the installation state and use the available recovery action.");
                }
                status.ForeColor = Color.FromArgb(170, 52, 59);
            }
        }

        private async Task VerifyAsync()
        {
            if (performingOperation) return;
            retry.Enabled = false;
            ConfigureActions(SetupOperation.None, SetupOperation.None,
                T("Недоступно", "Unavailable"));
            openApplication.Visible = false;
            status.Text = T("Проверка целостности…", "Verifying integrity…");
            status.ForeColor = Dark;
            version.Text = "—";
            packageDetails.Text = "";
            try
            {
                BundleInfo info = await Task.Run(
                    () => BundleReader.Inspect(Application.ExecutablePath));
                UpgradeAssessment plan = await Task.Run(
                    () => SetupInstallation.PlanUpgrade(Application.ExecutablePath));
                if (IsDisposed || Disposing) return;

                productName.Text = info.Name;
                productName.AccessibleName = info.Name;
                Text = info.Name + " — IWXA Setup";
                string versionLine = T("Версия ", "Version ") +
                    info.Version + "   •   " + info.Architecture;
                string packageLine = T("Файлов: ", "Files: ") + info.FileCount +
                    "   •   SHA-256 " + info.PackageSha256.Substring(0, 16) + "…";

                if (plan.Status == "NO_OWNED_INSTALLATION")
                {
                    InstallPreflight check = SetupReadiness.Check(info);
                    if (check.Status == "READY_FOR_FIRST_INSTALL")
                    {
                        SetupDiskPlan disk = SetupInstallation.CheckStageSpace(info);
                        if (disk.Status == "DISK_SPACE_READY")
                        {
                            SetState(T("Готово к установке", "Ready to install"),
                                packageLine, versionLine, false);
                            ConfigureActions(SetupOperation.Install, SetupOperation.None,
                                T("Установить", "Install"));
                        }
                        else ShowDiskSpaceRequired(disk, versionLine);
                    }
                    else if (check.Status == "WEBVIEW2_MISSING")
                    {
                        SetState(T("Требуется Microsoft WebView2", "Microsoft WebView2 required"),
                            T("Для работы приложения установите Evergreen Runtime. Если интернета нет, используйте официальный автономный установщик.",
                              "Install the Evergreen Runtime. Use Microsoft's standalone installer if offline."),
                            versionLine, true);
                        ConfigureActions(SetupOperation.InstallWebView2,
                            SetupOperation.InstallWebView2Offline,
                            T("Установить WebView2", "Install WebView2"));
                        openApplication.Tag = "WEBVIEW2";
                        openApplication.Text = T("Официальный автономный установщик (Microsoft)",
                            "Official offline installer (Microsoft)");
                        openApplication.Visible = true;
                    }
                    else
                    {
                        SetState(T("Требуется подготовка Windows", "Windows preparation needed"),
                            check.Status, versionLine, true);
                    }
                }
                else if (plan.Status == "UPGRADE_CANDIDATE_NOT_ACTIVATED")
                {
                    SetupDiskPlan disk = SetupInstallation.CheckStageSpace(info);
                    if (disk.Status != "DISK_SPACE_READY")
                    {
                        ShowDiskSpaceRequired(disk, versionLine);
                        // Disk pressure must not hide the already usable app.
                        openApplication.Tag = "APPLICATION";
                        openApplication.Text = T("Открыть установленную программу",
                            "Open installed application");
                        openApplication.Visible = true;
                    }
                    else
                    {
                    SetState(T("Доступно обновление", "Update available"),
                        T("Текущая версия: ", "Installed version: ") +
                        plan.InstalledVersion + "   •   " +
                        T("Старые файлы сохранятся до подтверждения.",
                          "Previous application files remain until confirmation."),
                        versionLine, false);
                    ConfigureActions(SetupOperation.Upgrade, SetupOperation.None,
                        T("Обновить", "Update"));
                    }
                }
                else if (plan.Status == "UPGRADE_PENDING_CONFIRMATION")
                {
                    SetState(T("Проверьте новую версию", "Verify the updated version"),
                        T("Откройте приложение, проверьте данные. Затем подтвердите обновление или верните прежнюю версию.",
                          "Open the application and check your data. Then confirm the update or roll back."),
                        versionLine, true);
                    ConfigureActions(SetupOperation.Confirm, SetupOperation.Rollback,
                        T("Подтвердить", "Confirm"));
                    openApplication.Tag = "APPLICATION";
                    openApplication.Text = T("Открыть установленную программу",
                        "Open installed application");
                    openApplication.Visible = true;
                }
                else if (plan.Status == "UPGRADE_RECOVERY_REQUIRED")
                {
                    SetState(T("Обновление было прервано", "Upgrade was interrupted"),
                        T("Доступно восстановление предыдущей версии; личные данные не удаляются.",
                          "Previous version recovery is available; personal data will not be removed."),
                        versionLine, true);
                    ConfigureActions(SetupOperation.Recover, SetupOperation.None,
                        T("Восстановить", "Recover"));
                }
                else if (plan.Status == "REPAIR_CANDIDATE_NOT_ACTIVATED")
                {
                    SetupDiskPlan disk = SetupInstallation.CheckStageSpace(info);
                    if (disk.Status != "DISK_SPACE_READY")
                    {
                        ShowDiskSpaceRequired(disk, versionLine);
                        // Disk pressure must not hide the already usable app.
                        openApplication.Tag = "APPLICATION";
                        openApplication.Text = T("Открыть установленную программу",
                            "Open installed application");
                        openApplication.Visible = true;
                    }
                    else
                    {
                    SetState(T("Эта версия уже установлена", "This version is installed"),
                        T("Если программа повреждена, её файлы можно восстановить без удаления личных данных.",
                          "If the application is damaged, repair its files without deleting personal data."),
                        versionLine, false);
                    ConfigureActions(SetupOperation.Repair, SetupOperation.None,
                        T("Восстановить файлы", "Repair files"));
                    openApplication.Tag = "APPLICATION";
                    openApplication.Text = T("Открыть установленную программу",
                        "Open installed application");
                    openApplication.Visible = true;
                    }
                }
                else if (plan.Status == "LEGACY_MIGRATION_HOLD")
                {
                    LegacyAssessment old = SetupLegacy.Inspect(info);
                    if (old.Status == "LEGACY_CONFIRMED_READ_ONLY" &&
                        info.NeedsWebView2 &&
                        String.IsNullOrWhiteSpace(SetupReadiness.DetectWebView2Version()))
                    {
                        SetState(T("Для новой версии необходим WebView2", "New version requires WebView2"),
                            T("Прежняя программа сохранена. Установите Runtime через интернет или из автономного файла Microsoft.",
                              "The existing application is retained. Install the Runtime online or from an offline Microsoft installer."),
                            versionLine, true);
                        ConfigureActions(SetupOperation.InstallWebView2,
                            SetupOperation.InstallWebView2Offline,
                            T("Установить WebView2", "Install WebView2"));
                        openApplication.Tag = "WEBVIEW2";
                        openApplication.Text = T("Автономный WebView2 от Microsoft",
                            "Offline WebView2 installer from Microsoft");
                        openApplication.Visible = true;
                    }
                    else if (old.Status == "LEGACY_CONFIRMED_READ_ONLY")
                    {
                        SetupDiskPlan disk = SetupInstallation.CheckStageSpace(info);
                        if (disk.Status != "DISK_SPACE_READY")
                        {
                            ShowDiskSpaceRequired(disk, versionLine);
                        }
                        else
                        {
                        SetState(T("Найдена прежняя версия " + old.Version,
                                   "Installed legacy version " + old.Version),
                            T("Установить " + info.Version + " отдельно для проверки. Прежняя программа, ярлыки и данные не удаляются.",
                              "Install " + info.Version + " separately for review. Existing program, shortcuts and data remain unchanged."),
                            versionLine, false);
                        ConfigureActions(SetupOperation.StageLegacyPreview,
                            SetupOperation.None, T("Установить для проверки", "Install to preview"));
                        }
                    }
                    else
                    {
                        SetState(T("Переход пока недоступен", "Legacy migration blocked"),
                            old.Status, versionLine, true);
                    }
                }
                else if (plan.Status == "LEGACY_MIGRATION_PENDING_GUI_READBACK")
                {
                    SetState(T("Пробная версия " + info.Version + " установлена",
                            "Preview version " + info.Version + " is installed"),
                        T("Откройте пробную версию и проверьте данные. Прежняя программа сохранена; переход можно отменить.",
                          "Open the preview and verify your data. The existing application is retained; you may cancel this preview."),
                        versionLine, true);
                    ConfigureActions(SetupOperation.CancelLegacyPreview,
                        SetupOperation.None, T("Отменить переход", "Cancel preview"));
                    openApplication.Tag = "APPLICATION";
                    openApplication.Text = T("Открыть пробную " + info.Version,
                        "Open preview " + info.Version);
                    openApplication.Visible = true;
                }
                else if (plan.Status == "LEGACY_MIGRATION_REVIEW_REQUIRED")
                {
                    SetState(T("Проверка старой установки не пройдена",
                               "Original installation requires inspection"),
                        T("Переход заблокирован; данные и прежняя установка не менялись.",
                          "Preview is blocked; the existing installation and data are unchanged."),
                        versionLine, true);
                }
                else
                {
                    SetState(T("Необходимо устранить препятствие", "Action needed"),
                        plan.Status + "   •   " + packageLine,
                        versionLine, true);
                }
            }
            catch (Exception ex)
            {
                if (IsDisposed || Disposing) return;
                status.Text = T("Пакет не подтверждён", "Package not verified");
                status.ForeColor = Color.FromArgb(170, 52, 59);
                version.Text = ex.Message;
                packageDetails.Text = T(
                    "Установка заблокирована. Загрузите исправный дистрибутив.",
                    "Installation is blocked. Obtain a valid distribution.");
            }
            finally { if (!IsDisposed && !Disposing) retry.Enabled = true; }
        }

    }
}

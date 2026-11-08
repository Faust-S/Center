using System;
using System.Drawing;
using System.Diagnostics;
using System.IO;
using System.Globalization;
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
        private enum SetupOperation { None, Install, Upgrade, Recover, Confirm, Rollback }
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
            var sidebar = new Panel { Dock = DockStyle.Left, Width = 235, BackColor = Dark };
            Controls.Add(sidebar);
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

            var area = new Panel { Dock = DockStyle.Fill, BackColor = Color.FromArgb(246, 249, 253) };
            Controls.Add(area);
            area.BringToFront();
            // Keep both areas visible: the sidebar has a fixed 235-pixel width.
            area.Dock = DockStyle.Fill;
            sidebar.BringToFront();

            var eyebrow = Label(T("ДИСТРИБУТИВ IWXA", "IWXA DISTRIBUTION"),
                32, 32, 550, 25, 9, Accent, true);
            area.Controls.Add(eyebrow);
            productName.Text = T("Проверка установщика", "Checking installer");
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
            install.Enabled = false;
            install.Size = new Size(165, 40);
            install.Margin = new Padding(5, 0, 5, 0);
            install.BackColor = Accent;
            install.ForeColor = Color.White;
            install.FlatStyle = FlatStyle.Flat;
            install.FlatAppearance.BorderSize = 0;
            install.Click += async (sender, args) => await ExecuteAsync(primaryAction);
            actions.Controls.Add(install);

            secondary.Visible = false;
            secondary.Size = new Size(170, 40);
            secondary.Margin = new Padding(5, 0, 5, 0);
            secondary.BackColor = Color.White;
            secondary.ForeColor = Color.FromArgb(39, 78, 133);
            secondary.FlatStyle = FlatStyle.Flat;
            secondary.FlatAppearance.BorderColor = Color.FromArgb(187, 205, 227);
            secondary.Click += async (sender, args) => await ExecuteAsync(secondaryAction);
            actions.Controls.Add(secondary);

            retry.Text = T("Проверить снова", "Verify again");
            retry.Size = new Size(153, 40);
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
            install.Enabled = !performingOperation && primary != SetupOperation.None;
            secondary.Visible = alternate != SetupOperation.None;
            secondary.Enabled = !performingOperation && alternate != SetupOperation.None;
            if (alternate == SetupOperation.Rollback)
                secondary.Text = T("Вернуть прежнюю", "Roll back");
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
                operation == SetupOperation.Recover || operation == SetupOperation.Rollback ?
                T("Восстановление предыдущей версии…", "Restoring previous version…") :
                operation == SetupOperation.Confirm ?
                T("Завершение обновления…", "Finalizing upgrade…") :
                T("Установка проверенных файлов…", "Installing verified files…");
            try
            {
                InstallOutcome result = await Task.Run(() =>
                {
                    string executable = Application.ExecutablePath;
                    switch (operation)
                    {
                        case SetupOperation.Install: return SetupInstallation.InstallFresh(executable);
                        case SetupOperation.Upgrade: return SetupInstallation.UpgradeOwned(executable);
                        case SetupOperation.Recover: return SetupInstallation.RecoverOwned(executable);
                        case SetupOperation.Rollback: return SetupInstallation.RollbackOwned(executable);
                        case SetupOperation.Confirm: return SetupInstallation.ConfirmUpgrade(executable);
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
                else if (operation == SetupOperation.Install)
                    status.Text = T("Приложение установлено", "Application installed");
                else if (operation == SetupOperation.Rollback ||
                         result.Status == "RECOVERED_PREVIOUS_RELEASE")
                    status.Text = T("Предыдущая версия восстановлена", "Previous version restored");
                else if (operation == SetupOperation.Confirm)
                    status.Text = T("Обновление завершено", "Upgrade finalized");
                status.ForeColor = Color.FromArgb(24, 119, 91);
            }
            catch (Exception ex)
            {
                status.Text = T("Операция не завершена", "Operation incomplete");
                status.ForeColor = Color.FromArgb(170, 52, 59);
                version.Text = ex.Message;
                packageDetails.Text = T(
                    "Действующая версия сохранена, если не требуется восстановление. Нажмите «Проверить снова».",
                    "Existing installation is preserved unless recovery is required. Select Verify again.");
            }
            finally
            {
                performingOperation = false;
                retry.Enabled = true;
                openApplication.Enabled = true;
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
                        SetState(T("Готово к установке", "Ready to install"),
                            packageLine, versionLine, false);
                        ConfigureActions(SetupOperation.Install, SetupOperation.None,
                            T("Установить", "Install"));
                    }
                    else if (check.Status == "WEBVIEW2_MISSING")
                    {
                        SetState(T("Требуется Microsoft WebView2", "Microsoft WebView2 required"),
                            T("Для работы приложения установите Evergreen Runtime. Если интернета нет, используйте официальный автономный установщик.",
                              "Install the Evergreen Runtime. Use Microsoft's standalone installer if offline."),
                            versionLine, true);
                        openApplication.Tag = "WEBVIEW2";
                        openApplication.Text = T("Страница установки WebView2 (Microsoft)",
                            "WebView2 download page (Microsoft)");
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
                    SetState(T("Доступно обновление", "Update available"),
                        T("Текущая версия: ", "Installed version: ") +
                        plan.InstalledVersion + "   •   " +
                        T("Старые файлы сохранятся до подтверждения.",
                          "Previous application files remain until confirmation."),
                        versionLine, false);
                    ConfigureActions(SetupOperation.Upgrade, SetupOperation.None,
                        T("Обновить", "Update"));
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
                    SetState(T("Эта версия уже установлена", "This version is installed"),
                        T("Программа зарегистрирована. Личные данные не менялись.",
                          "Application registration exists; personal data was not modified."),
                        versionLine, false);
                    openApplication.Tag = "APPLICATION";
                    openApplication.Text = T("Открыть установленную программу",
                        "Open installed application");
                    openApplication.Visible = true;
                }
                else if (plan.Status == "LEGACY_MIGRATION_HOLD")
                {
                    SetState(T("Обнаружена прежняя установка", "Previous installer detected"),
                        T("Установленная версия NSIS сохранена. Переход на IWXA Setup пока недоступен.",
                          "The existing NSIS application is preserved. Migration is not yet available."),
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

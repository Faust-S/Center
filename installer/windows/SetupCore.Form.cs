using System;
using System.Drawing;
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

            retry.Text = T("Проверить снова", "Verify again");
            retry.Location = new Point(31, 487);
            retry.Size = new Size(173, 39);
            retry.BackColor = Color.White;
            retry.FlatStyle = FlatStyle.Flat;
            retry.FlatAppearance.BorderColor = Color.FromArgb(187, 205, 227);
            retry.ForeColor = Color.FromArgb(39, 78, 133);
            retry.Click += async (sender, args) => await VerifyAsync();
            area.Controls.Add(retry);

            install.Text = T("Установить", "Install");
            install.Enabled = false; // S1: never pretend an application was installed.
            install.Location = new Point(433, 487);
            install.Size = new Size(177, 39);
            install.Anchor = AnchorStyles.Right | AnchorStyles.Bottom;
            install.BackColor = Accent;
            install.ForeColor = Color.White;
            install.FlatStyle = FlatStyle.Flat;
            install.FlatAppearance.BorderSize = 0;
            area.Controls.Add(install);
            install.Click += async (sender, args) => await InstallAsync();
        }

        private async Task InstallAsync()
        {
            install.Enabled = false;
            retry.Enabled = false;
            status.Text = T("Установка проверенных файлов…",
                "Installing verified files…");
            status.ForeColor = Dark;
            try
            {
                InstallOutcome result = await Task.Run(
                    () => SetupInstallation.InstallFresh(Application.ExecutablePath));
                status.Text = T("Приложение установлено", "Application installed");
                status.ForeColor = Color.FromArgb(24, 119, 91);
                version.Text = result.Version + "   •   " +
                    T("Первый запуск ещё не проверен", "First launch not yet verified");
                packageDetails.Text = T(
                    "Данные других приложений и предыдущих установок не изменены.",
                    "Other applications and previously installed data were not changed.");
            }
            catch (Exception ex)
            {
                status.Text = T("Установка не завершена", "Installation incomplete");
                status.ForeColor = Color.FromArgb(170, 52, 59);
                version.Text = ex.Message;
                packageDetails.Text = T(
                    "Действующая версия не заменялась. Исправьте причину и повторите.",
                    "No existing version was replaced. Resolve the issue and retry.");
            }
            finally { retry.Enabled = true; }
        }

        private async Task VerifyAsync()
        {
            retry.Enabled = false;
            install.Enabled = false;
            status.Text = T("Проверка целостности…", "Verifying integrity…");
            version.Text = "—";
            packageDetails.Text = "";
            try
            {
                BundleInfo info = await Task.Run(
                    () => BundleReader.Inspect(Application.ExecutablePath));
                productName.Text = info.Name;
                Text = info.Name + " — IWXA Setup";
                status.Text = T("Содержимое проверено", "Package verified");
                status.ForeColor = Color.FromArgb(24, 119, 91);
                version.Text = T("Версия ", "Version ") + info.Version +
                    "   •   " + info.Architecture;
                InstallPreflight check = SetupReadiness.Check(info);
                install.Enabled = check.Status == "READY_FOR_FIRST_INSTALL";
                packageDetails.Text = T("Файлов: ", "Files: ") + info.FileCount +
                    "   •   SHA-256 " + info.PackageSha256.Substring(0, 16) + "…";
                if (check.Status != "READY_FOR_FIRST_INSTALL")
                {
                    version.Text += "   •   " + check.Status;
                    status.Text = T("Требуется подготовка Windows",
                        "Windows preparation needed");
                }
            }
            catch (Exception ex)
            {
                status.Text = T("Пакет не подтверждён", "Package not verified");
                status.ForeColor = Color.FromArgb(170, 52, 59);
                version.Text = ex.Message;
                packageDetails.Text = T(
                    "Установка заблокирована. Загрузите исправный дистрибутив.",
                    "Installation is blocked. Obtain a valid distribution.");
            }
            finally { retry.Enabled = true; }
        }
    }
}

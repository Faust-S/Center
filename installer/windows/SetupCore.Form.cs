using System;
using System.Drawing;
using System.Diagnostics;
using System.IO;
using System.Globalization;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace IwxaSetup
{
    internal sealed partial class SetupForm : Form
    {
        private static readonly Color Dark = Color.FromArgb(31, 45, 67);
        private static readonly Color Accent = Color.FromArgb(39, 109, 243);
        private static readonly Color Secondary = Color.FromArgb(98, 115, 139);
        private readonly bool ru = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "ru";
        private readonly Label productName = new Label();
        private readonly Label description = new Label();
        private readonly Label status = new Label();
        private readonly Label version = new Label();
        private readonly TextBox packageDetails = new TextBox();
        private readonly Button retry = new Button();
        private readonly Button install = new Button();
        private readonly Button secondary = new Button();
        private readonly LinkLabel openApplication = new LinkLabel();
        private readonly Button removeApplication = new Button();
        private readonly LinkLabel technicalDetails = new LinkLabel();
        private string technicalReport = "";
        private readonly Button configureInstallation = new Button();
        private readonly Button cancelStorageMove = new Button();
        private readonly ToolTip detailsHint = new ToolTip();
        private System.Threading.CancellationTokenSource storageCancellation;
        private BundleInfo inspectedBundle;
        private string inspectedStatus = "";
        private SetupLocations selectedLocations;
        private readonly ProgressBar busyProgress = new ProgressBar();
        private enum SetupOperation { None, Install, Upgrade, Recover, Confirm, Rollback,
            StageLegacyPreview, CancelLegacyPreview, ActivateLegacyDefault,
            RestoreLegacyDefault, InstallWebView2, InstallWebView2Offline, Repair }
        private SetupOperation primaryAction = SetupOperation.None;
        private SetupOperation secondaryAction = SetupOperation.None;
        private bool performingOperation = false;
        private bool verifyingState = false;

        internal SetupForm()
        {
            Text = "IWXA Setup";
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 10F);
            AutoScaleMode = AutoScaleMode.Dpi;
            // A 1920x1080 laptop at 200% has ~960x540 logical pixels.
            // Use the existing compact layout rather than forcing the
            // bottom action row outside the desktop working area.
            MinimumSize = new Size(750, 520);
            ClientSize = new Size(900, 560);
            BackColor = Color.FromArgb(246, 249, 253);
            MaximizeBox = false;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); }
            catch { Icon = SystemIcons.Application; }
            BuildLayout();
            // Enter activates the current primary action. Escape closes the
            // idle form; FormClosing prevents interruption of live writes.
            AcceptButton = install;
            KeyPreview = true;
            KeyDown += (sender, args) =>
            {
                if (args.KeyCode != Keys.Escape) return;
                args.Handled = true;
                args.SuppressKeyPress = true;
                Close();
            };
            FormClosing += (sender, args) =>
            {
                if (!performingOperation)
                {
                    if (locationDraftChanged)
                    {
                        DialogResult answer = MessageBox.Show(this,
                            T("Несохранённые настройки будут отменены. Закрыть установщик?",
                              "Unsaved settings will be discarded. Close setup?"),
                            T("Папки и запуск", "Folders and startup"),
                            MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                            MessageBoxDefaultButton.Button2);
                        if (answer != DialogResult.Yes) args.Cancel = true;
                    }
                    return;
                }
                args.Cancel = true;
                if (storageCancellation != null)
                {
                    if (!storageCancellation.IsCancellationRequested)
                        storageCancellation.Cancel();
                    cancelStorageMove.Enabled = false;
                    status.Text = T("Останавливаем перенос…",
                        "Cancelling storage move…");
                }
                else
                {
                    status.Text = T("Завершаем операцию…",
                        "Finishing operation…");
                    packageDetails.Text = T(
                        "Дождитесь завершения. Закрыть установщик можно после проверки результата.",
                        "Wait until this operation finishes. You can close setup after its result is checked.");
                }
            };
            Shown += async (sender, args) =>
            {
                FitInitialWindowToWorkingArea();
                await VerifyAsync();
                if (!IsDisposed && !Disposing && install.Enabled)
                    install.Focus();
            };
        }

        // Use physical window and working-area sizes after WinForms DPI
        // scaling. The requested size must never force the bottom action row
        // below the visible desktop, especially on 1080p / 200% displays.
        internal static Size FitToWorkingAreaSize(
            Size requested, Size minimum, Size available)
        {
            if (available.Width <= 0 || available.Height <= 0)
                return requested;
            int width = Math.Max(Math.Min(minimum.Width, available.Width),
                Math.Min(requested.Width, available.Width));
            int height = Math.Max(Math.Min(minimum.Height, available.Height),
                Math.Min(requested.Height, available.Height));
            return new Size(width, height);
        }

        private void FitInitialWindowToWorkingArea()
        {
            Rectangle work = Screen.FromControl(this).WorkingArea;
            if (work.Width <= 0 || work.Height <= 0) return;
            Size size = FitToWorkingAreaSize(Size, MinimumSize, work.Size);
            if (MinimumSize.Width > work.Width ||
                MinimumSize.Height > work.Height)
                MinimumSize = new Size(
                    Math.Min(MinimumSize.Width, work.Width),
                    Math.Min(MinimumSize.Height, work.Height));
            Size = size;
            Location = new Point(work.Left + (work.Width - Width) / 2,
                work.Top + (work.Height - Height) / 2);
        }

        // WinForms CenterParent can position a DPI-scaled form below the
        // visible taskbar even after its size was clamped. Adjust BOTH size
        // and origin, using the monitor that contains the actual dialog.
        private static void FitDialogToWorkingArea(Form dialog)
        {
            Rectangle work = Screen.FromControl(dialog).WorkingArea;
            if (work.Width <= 0 || work.Height <= 0) return;
            if (dialog.MinimumSize.Width > work.Width ||
                dialog.MinimumSize.Height > work.Height)
                dialog.MinimumSize = new Size(
                    Math.Min(dialog.MinimumSize.Width, work.Width),
                    Math.Min(dialog.MinimumSize.Height, work.Height));
            dialog.Size = FitToWorkingAreaSize(dialog.Size,
                dialog.MinimumSize, work.Size);
            dialog.Location = new Point(
                work.Left + Math.Max(0, (work.Width - dialog.Width) / 2),
                work.Top + Math.Max(0, (work.Height - dialog.Height) / 2));
        }

        private string T(string russian, string english)
        {
            return ru ? russian : english;
        }

        // The settings panels use the same quiet secondary-action style
        // throughout. Native Windows focus and accessibility are retained.
        private static void StyleSecondaryButton(Button button)
        {
            button.FlatStyle = FlatStyle.Flat;
            button.BackColor = Color.FromArgb(245, 248, 253);
            button.ForeColor = Dark;
            button.FlatAppearance.BorderSize = 1;
            button.FlatAppearance.BorderColor = Color.FromArgb(188, 204, 225);
            button.FlatAppearance.MouseOverBackColor = Color.FromArgb(230, 239, 252);
        }

        private void BuildLayout()
        {
            BuildExperienceLayout();
        }



        private void SetWizardStep(int current)
        {
            journeyStage.Text = current == 1 ?
                T("ПРОВЕРКА ПРОГРАММЫ", "CHECKING APPLICATION") :
                current == 3 ? T("ПРОВЕРЬТЕ РЕЗУЛЬТАТ", "REVIEW THE RESULT") :
                T("УСТАНОВКА И ОБСЛУЖИВАНИЕ", "INSTALL AND MAINTAIN");
        }

        private void ConfigureActions(
            SetupOperation primary, SetupOperation alternate, string primaryLabel)
        {
            primaryAction = primary;
            secondaryAction = alternate;
            install.Text = primaryLabel;
            install.AccessibleName = primaryLabel;
            install.Enabled = !performingOperation && !verifyingState &&
                primary != SetupOperation.None;
            secondary.Visible = alternate != SetupOperation.None;
            secondary.Enabled = !performingOperation && !verifyingState &&
                alternate != SetupOperation.None;
            if (alternate == SetupOperation.Rollback)
                secondary.Text = T("Вернуть прежнюю", "Roll back");
            else if (alternate == SetupOperation.InstallWebView2Offline)
                secondary.Text = T("Из файла…", "From file…");
            else if (alternate == SetupOperation.CancelLegacyPreview)
                secondary.Text = T("Отменить переход", "Cancel preview");
            secondary.AccessibleName = secondary.Text;
            secondary.AccessibleDescription =
                alternate == SetupOperation.InstallWebView2Offline ?
                    T("Выбрать официальный автономный установщик WebView2 на диске",
                      "Choose Microsoft's offline WebView2 installer file") :
                alternate == SetupOperation.Rollback ?
                    T("Восстановить прежнюю установленную версию",
                      "Restore the previously installed version") :
                alternate == SetupOperation.CancelLegacyPreview ?
                    T("Отменить предпросмотр, сохранив прежнюю установку",
                      "Cancel the preview without changing the existing installation") : "";
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

        // The Runtime can disappear after a successful product installation
        // (for example, after a Windows image reset or enterprise cleanup).
        // Offer Microsoft's existing online/offline recovery path without
        // replacing or touching any installed application or user data.
        private void OfferWebView2Recovery(string versionLine, bool installedProduct)
        {
            SetState(T("Требуется Microsoft WebView2", "Microsoft WebView2 required"),
                installedProduct ?
                    T("Программа уже установлена, но WebView2 отсутствует. Установите официальный Runtime через интернет или из файла Microsoft. Файлы программы и личные данные не изменятся.",
                      "The application is installed, but WebView2 is missing. Install Microsoft's Runtime online or from an offline file. Application files and user data will not be changed.") :
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

        // The ordinary screen explains the next step. Package identity and
        // failure codes remain available only through an explicit user action.
        private void SetTechnicalReport(BundleInfo info, string state, string failure)
        {
            var report = new StringBuilder();
            report.AppendLine("IWXA Setup Core 1.0");
            if (info != null)
            {
                report.AppendLine("Product: " + info.Id);
                report.AppendLine("Version: " + info.Version);
                report.AppendLine("Architecture: " + info.Architecture);
                report.AppendLine("Package: " + info.PackageFormat);
                report.AppendLine("Files: " + info.FileCount);
                report.AppendLine("Package SHA-256: " + info.PackageSha256);
                report.AppendLine("Source: " + info.SourceCommit);
            }
            if (!String.IsNullOrWhiteSpace(state))
                report.AppendLine("State: " + state);
            if (!String.IsNullOrWhiteSpace(failure))
                report.AppendLine("Detail: " + failure);
            technicalReport = report.ToString();
            technicalDetails.Visible = true;
        }

        private Form CreateTechnicalDetailsDialog()
        {
            var dialog = new Form {
                Text = T("Технические сведения", "Technical details"),
                StartPosition = FormStartPosition.CenterParent,
                ClientSize = new Size(700, 420),
                MinimumSize = new Size(490, 305),
                Font = new Font("Segoe UI", 10F),
                AutoScaleMode = AutoScaleMode.Dpi,
                BackColor = Color.White,
                ShowInTaskbar = false
            };
            var shell = new TableLayoutPanel {
                Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3,
                BackColor = Color.White, Padding = new Padding(18)
            };
            shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 58F));
            shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 53F));
            dialog.Controls.Add(shell);
            var explanation = new Label {
                Dock = DockStyle.Fill,
                Text = T(
                    "Эти сведения помогут разобраться, если установка не завершилась. При обращении за помощью скопируйте их.",
                    "These details can help diagnose an incomplete installation. Copy them when requesting support."),
                ForeColor = Secondary, AutoEllipsis = true
            };
            shell.Controls.Add(explanation, 0, 0);
            var report = new TextBox {
                Name = "iwxaSetupTechnicalReport",
                Dock = DockStyle.Fill, Text = technicalReport,
                Font = new Font("Consolas", 9F),
                Multiline = true, ReadOnly = true,
                ScrollBars = ScrollBars.Both, WordWrap = false,
                AccessibleName = T("Сведения об установке",
                    "Installation diagnostics")
            };
            shell.Controls.Add(report, 0, 1);
            var footer = new FlowLayoutPanel {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.RightToLeft,
                WrapContents = false
            };
            var close = new Button {
                Name = "iwxaSetupTechnicalClose",
                Text = T("Закрыть", "Close"),
                Size = new Size(112, 37),
                DialogResult = DialogResult.OK
            };
            StyleSecondaryButton(close);
            var copy = new Button {
                Name = "iwxaSetupCopyTechnicalReport",
                Text = T("Скопировать сведения", "Copy details"),
                AccessibleName = T("Скопировать сведения для поддержки",
                    "Copy diagnostics for support"),
                Size = new Size(205, 37),
                BackColor = Accent, ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat
            };
            copy.Click += (sender, args) =>
            {
                try
                {
                    Clipboard.SetText(report.Text);
                    copy.Text = T("Скопировано", "Copied");
                }
                catch (System.Runtime.InteropServices.ExternalException)
                {
                    MessageBox.Show(dialog,
                        T("Не удалось скопировать автоматически. Выделите сведения и нажмите Ctrl+C.",
                            "Copying is unavailable. Select the details and press Ctrl+C."),
                        T("Технические сведения", "Technical details"),
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            };
            footer.Controls.Add(close);
            footer.Controls.Add(copy);
            shell.Controls.Add(footer, 0, 2);
            dialog.AcceptButton = close;
            dialog.CancelButton = close;
            dialog.Shown += (sender, args) =>
                FitDialogToWorkingArea(dialog);
            return dialog;
        }

        internal static bool AllowsOwnedUninstall(string state)
        {
            switch (state)
            {
                case "REPAIR_CANDIDATE_NOT_ACTIVATED":
                case "UPGRADE_CANDIDATE_NOT_ACTIVATED":
                case "WEBVIEW2_MISSING":
                case "APPLICATION_RUNNING":
                case "DOWNGRADE_BLOCKED":
                case "SAME_VERSION_DIFFERENT_PACKAGE":
                case "VERSION_UNSUPPORTED":
                    return true;
                default:
                    // No removal while an upgrade, legacy handoff or ownership
                    // recovery is pending, or before ownership is established.
                    return false;
            }
        }

        private string ExplainBlockedState(string state)
        {
            switch (state)
            {
                case "INSTALL_OPERATION_BUSY":
                    return T("Другая операция установки ещё выполняется. Дождитесь её завершения и проверьте снова.",
                        "Another installation operation is running. Let it finish, then verify again.");
                case "APPLICATION_RUNNING":
                    return T("Программа сейчас открыта. Закройте её перед обновлением, восстановлением или удалением.",
                        "The application is open. Close it before updating, repairing or uninstalling.");
                case "DOWNGRADE_BLOCKED":
                    return T("На компьютере установлена более новая версия. Используйте её или загрузите подходящее обновление.",
                        "A newer version is installed. Use it or obtain a suitable update.");
                case "SAME_VERSION_DIFFERENT_PACKAGE":
                    return T("Найден другой выпуск с таким же номером версии. Для замены нужен согласованный пакет обновления.",
                        "A different build of this version is installed. Use the matching update package.");
                case "VERSION_UNSUPPORTED":
                    return T("Не удалось сравнить версии. Проверьте выпуск программы и повторите попытку.",
                        "The installed version could not be compared. Check the release and try again.");
                case "OWNERSHIP_MISMATCH":
                case "UNOWNED_INSTALL_ROOT":
                    return T("В папке обнаружена установка, принадлежность которой не подтверждена. Выберите другую папку или восстановите исходную программу.",
                        "An existing installation could not be verified. Choose another folder or repair the original app.");
                case "ARCHITECTURE_UNSUPPORTED":
                    return T("Этот выпуск предназначен для Windows x64. Проверьте версию Windows и выберите подходящий установщик.",
                        "This release requires Windows x64. Check your Windows version and choose a compatible installer.");
                default:
                    return T("Установка пока недоступна. Проверьте состояние программы и повторите попытку. Личные данные не изменены.",
                        "Installation is not available yet. Check the application and verify again. Your data was not changed.");
            }
        }

        private void SetState(
            string heading, string details, string versionLine, bool warning)
        {
            status.Text = heading;
            status.ForeColor = warning ?
                Color.FromArgb(164, 92, 29) : Color.FromArgb(24, 119, 91);
            version.Text = versionLine;
            packageDetails.Text = details;
            status.AccessibleDescription = heading;
            packageDetails.AccessibleDescription = details;
            detailsHint.SetToolTip(status, heading);
            detailsHint.SetToolTip(packageDetails, details);
        }

        private async Task<bool> ApplyOptionsAsync(
            BundleInfo info, SetupLocations current,
            SetupLocations updated, bool first)
        {
                if (first)
                {
                    selectedLocations = updated;
                    await VerifyAsync();
                    return true;
                }
                bool moving = !String.Equals(current.DataRoot,
                        updated.DataRoot, StringComparison.OrdinalIgnoreCase) ||
                    !String.Equals(current.SoftwareRoot, updated.SoftwareRoot,
                        StringComparison.OrdinalIgnoreCase) ||
                    !String.Equals(current.ModelsRoot, updated.ModelsRoot,
                        StringComparison.OrdinalIgnoreCase) ||
                    !String.Equals(current.CacheRoot, updated.CacheRoot,
                        StringComparison.OrdinalIgnoreCase);
                if (moving)
                {
                    DialogResult approve = MessageBox.Show(this,
                        T("Скопировать данные в выбранные папки, проверить каждую копию и переключить хранилища? Исходные папки останутся на месте. Перед переносом закройте программу.",
                          "Copy data to the new folders, verify each copy, then switch storage? The original folders will be kept. Close the application first."),
                        T("Подтвердить перенос", "Confirm storage relocation"),
                        MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                        MessageBoxDefaultButton.Button2);
                    if (approve != DialogResult.Yes) return false;
                }
                var activeCancellation = moving ?
                    new System.Threading.CancellationTokenSource() : null;
                storageCancellation = activeCancellation;
                FocusOperationProgress();
                performingOperation = true;
                busyProgress.Visible = true;
                RefreshExperienceButtons();
                busyProgress.Style = moving ?
                    ProgressBarStyle.Continuous : ProgressBarStyle.Marquee;
                if (moving) busyProgress.Value = 0;
                cancelStorageMove.Visible = moving;
                cancelStorageMove.Enabled = moving;
                if (moving)
                {
                    install.Visible = false;
                    secondary.Visible = false;
                    retry.Visible = false;
                }
                status.Text = moving ?
                    T("Копируем и проверяем данные…", "Copying and verifying data…") :
                    T("Применяем параметры запуска…", "Applying startup settings…");
                install.Enabled = false;
                secondary.Enabled = false;
                retry.Enabled = false;
                configureInstallation.Enabled = false;
                removeApplication.Enabled = false;
                // Do not let the user start an application that could write
                // to the source while data is being copied and verified.
                openApplication.Enabled = false;
                Exception error = null;
                Action<long, long> progress = null;
                if (moving)
                {
                    int lastPercent = -1;
                    progress = (copied, total) =>
                    {
                        int percent = total <= 0 ? 0 :
                            (int)Math.Min(99, Math.Floor(copied * 100.0 / total));
                        if (percent <= lastPercent) return;
                        lastPercent = percent;
                        try
                        {
                            if (!IsHandleCreated || IsDisposed) return;
                            BeginInvoke((MethodInvoker)(() =>
                            {
                                if (IsDisposed || storageCancellation != activeCancellation)
                                    return;
                                busyProgress.Value = percent;
                                status.Text = T("Перенос данных: ", "Moving storage: ") +
                                    percent + "%";
                                packageDetails.Text =
                                    T("Скопировано: ", "Copied: ") +
                                    StorageAmount(copied) + " / " +
                                    StorageAmount(total) + Environment.NewLine +
                                    T("Проверяем копии перед переключением папок.",
                                      "Verifying copies before changing storage locations.");
                            }));
                        }
                        catch (ObjectDisposedException) { }
                        catch (InvalidOperationException) { }
                    };
                }
                try
                {
                    await Task.Run(() => {
                        SetupInstallation.ApplyPreferences(info, updated,
                            moving ? activeCancellation.Token :
                                System.Threading.CancellationToken.None, progress);
                    });
                }
                catch (Exception ex) { error = ex; }
                finally
                {
                    storageCancellation = null;
                    if (activeCancellation != null) activeCancellation.Dispose();
                    performingOperation = false;
                    busyProgress.Visible = false;
                    busyProgress.Style = ProgressBarStyle.Marquee;
                    cancelStorageMove.Visible = false;
                    cancelStorageMove.Enabled = false;
                    install.Visible = true;
                    retry.Visible = true;
                }
                await VerifyAsync();
                if (error != null)
                    SetTechnicalReport(info, inspectedStatus, error.Message);
                if (error is OperationCanceledException)
                {
                    status.Text = T("Перенос отменён", "Storage relocation cancelled");
                    packageDetails.Text = T(
                        "Исходные данные и действующие папки сохранены.",
                        "Original data and active storage locations were preserved.");
                }
                else if (error != null)
                {
                    // A startup shortcut can change after preflight. When a
                    // copy has already been published, do not falsely claim
                    // that all settings remained unchanged.
                    bool storageAlreadySwitched = false;
                    if (moving)
                    {
                        try
                        {
                            SetupLocations actual =
                                SetupInstallation.InstalledLocations(info);
                            storageAlreadySwitched =
                                String.Equals(actual.DataRoot, updated.DataRoot,
                                    StringComparison.OrdinalIgnoreCase) &&
                                String.Equals(actual.SoftwareRoot, updated.SoftwareRoot,
                                    StringComparison.OrdinalIgnoreCase) &&
                                String.Equals(actual.ModelsRoot, updated.ModelsRoot,
                                    StringComparison.OrdinalIgnoreCase) &&
                                String.Equals(actual.CacheRoot, updated.CacheRoot,
                                    StringComparison.OrdinalIgnoreCase);
                        }
                        catch (Exception) { }
                    }
                    if (storageAlreadySwitched)
                    {
                        status.Text = T("Папки перенесены; настройте запуск",
                            "Storage moved; review startup setting");
                        packageDetails.Text = T(
                            "Новые папки действуют. Настройка запуска Windows не подтверждена. Исходные данные сохранены.",
                            "New storage locations are active. Windows startup could not be confirmed. Original data was preserved.");
                    }
                    MessageBox.Show(this,
                        storageAlreadySwitched ?
                            T("Хранилища перенесены и проверены, но параметр запуска Windows не удалось завершить. Исходные папки сохранены. Проверьте настройки запуска и повторите попытку.",
                              "Storage was moved and verified, but Windows startup could not be updated. Original folders are intact. Review startup settings and retry.") :
                            ExplainStorageSettingsError(error),
                        T("Параметры установки", "Installation settings"),
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
                else
                {
                    status.Text = moving ?
                        T("Хранилища перенесены", "Storage locations updated") :
                        T("Параметры сохранены", "Settings saved");
                    packageDetails.Text = moving ?
                        T("Новые папки проверены и действуют. Исходные данные сохранены.",
                          "New locations were verified and applied. Original data was kept.") :
                        T("Настройка запуска Windows применена и проверена.",
                          "Windows startup preference was applied and verified.");
                }
                RefreshExperienceButtons();
                return error == null;
        }

        private string StorageAmount(long bytes)
        {
            if (bytes >= 1073741824L)
                return (bytes / 1073741824.0).ToString("N1", CultureInfo.CurrentCulture) +
                    T(" ГБ", " GB");
            return (bytes / 1048576.0).ToString("N1", CultureInfo.CurrentCulture) +
                T(" МБ", " MB");
        }

        private string ExplainStorageSettingsError(Exception error)
        {
            string raw = error.Message ?? "";
            if (error is OperationCanceledException)
                return T("Перенос отменён. Исходные данные и настройки сохранены.",
                    "Relocation cancelled. Original data and settings were preserved.");
            if (raw.StartsWith("SETUP_STORAGE_DISK_SPACE_INSUFFICIENT_",
                StringComparison.Ordinal))
            {
                Match match = Regex.Match(raw,
                    @"required=(\d+)_available=(\d+)_volume=(.+)$");
                long required, available;
                if (match.Success &&
                    Int64.TryParse(match.Groups[1].Value, out required) &&
                    Int64.TryParse(match.Groups[2].Value, out available))
                    return T("На диске ", "Not enough space on ") +
                        match.Groups[3].Value +
                        T(" не хватает места. Для переноса нужно ",
                          ". Moving your storage requires ") +
                        Math.Ceiling(required / 1048576.0).ToString("N0") +
                        T(" МБ, доступно ", " MB, with ") +
                        Math.Floor(available / 1048576.0).ToString("N0") +
                        T(" МБ. Выберите другой диск или освободите место. Исходные данные сохранены.",
                          " MB available. Choose another drive or free up space. The original data was preserved.");
                return T("На выбранном диске недостаточно места для переноса. Исходные данные сохранены.",
                    "The selected drive does not have enough space. The original data was preserved.");
            }
            if (raw == "SETUP_STORAGE_TARGET_NOT_EMPTY_OR_EXISTS")
                return T("В папке назначения уже есть данные. Выберите новую папку: существующие файлы не будут заменены.",
                    "The destination folder already exists. Choose a new folder; existing files will not be replaced.");
            if (raw == "SETUP_STORAGE_LOCATIONS_OVERLAP" ||
                raw == "SETUP_STORAGE_MOVE_OVERLAPS_OLD_LOCATION")
                return T("Папки программы и хранилищ не должны находиться одна внутри другой. Выберите отдельные папки.",
                    "Application and storage folders must not overlap. Choose separate folders.");
            if (raw.StartsWith("SETUP_INSTALL_ROOT_", StringComparison.Ordinal))
                return T("Выберите обычную папку на локальном диске, вне системных каталогов Windows.",
                    "Choose a regular folder on a local drive outside the Windows system directories.");
            if (raw == "SETUP_PROGRAM_RELOCATION_REQUIRES_REINSTALL")
                return T("Папку установленной программы нельзя изменить здесь. Папки данных можно перенести отдельно.",
                    "The installed application folder cannot be changed here. Data storage can be relocated separately.");
            if (raw == "SETUP_INSTALL_ALREADY_RUNNING")
                return T("Установщик уже выполняет другую операцию. Завершите её и попробуйте снова.",
                    "Another setup operation is running. Finish it before trying again.");
            if (raw == "SETUP_STARTUP_SHORTCUT_CONFLICT")
                return T("Автозапуск не изменён: в Windows уже существует ярлык с таким именем, принадлежащий другой программе. Проверьте папку автозагрузки и повторите попытку. Чужой ярлык не изменён.",
                    "Startup was not changed: a shortcut with this name already belongs to another application. Check the Windows Startup folder and retry. The other shortcut was not modified.");
            if (raw == "SETUP_SETTINGS_READBACK_MISMATCH")
                return T("Windows не подтвердила все выбранные параметры. Откройте настройки, проверьте действующие папки и запуск, затем повторите попытку.",
                    "Windows did not confirm all selected settings. Review active storage locations and startup, then retry.");
            if (raw.StartsWith("SETUP_STORAGE_SOURCE_VOLUME_UNAVAILABLE", StringComparison.Ordinal))
                return T("Исходное хранилище находится на отключённом диске. Подключите диск перед переносом: иначе не получится сохранить все файлы.",
                    "The original storage is on a disconnected drive. Reconnect it before moving files so nothing is left behind.");
            if (raw.StartsWith("SETUP_STORAGE_VOLUME_UNAVAILABLE", StringComparison.Ordinal))
                return T("Один из выбранных дисков недоступен. Подключите его или выберите другую папку. Данные не изменены.",
                    "One of the selected drives is unavailable. Reconnect it or choose another folder. Your data was not changed.");
            if (raw == "SETUP_STORAGE_SOURCE_LINK_FORBIDDEN" ||
                raw == "SETUP_STORAGE_FILE_LINK_FORBIDDEN")
                return T("В исходном хранилище есть ссылка на другую папку или файл. Автоматический перенос остановлен; исходные данные сохранены.",
                    "The source contains a linked folder or file. Automatic relocation stopped; the original data was preserved.");
            return T("Не удалось применить параметры. Действующие данные сохранены. Попробуйте снова или проверьте технические сведения.",
                "Could not apply settings. Existing data was preserved. Try again or review Technical details.");
        }

        private async Task BeginUninstallAsync()
        {
            if (performingOperation || verifyingState || inspectedBundle == null ||
                !removeApplication.Visible) return;
            BundleInfo expected = inspectedBundle;
            DialogResult answer;
            try { answer = ConfirmExperienceUninstall(expected); }
            catch (Exception ex)
            {
                SetTechnicalReport(expected, inspectedStatus, ex.Message);
                MessageBox.Show(this,
                    T("Не удалось открыть подтверждение удаления. Проверьте действующую установку.",
                        "Could not open the uninstall review. Check the installed application."),
                    T("Удаление программы", "Uninstall application"),
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            if (answer != DialogResult.Yes) return;
            int optionalRemoval = selectedRemovalMask;
            FocusOperationProgress();
            performingOperation = true;
            busyProgress.Visible = true;
            RefreshExperienceButtons();
            status.Text = T("Подготавливаем удаление…",
                "Preparing uninstallation…");
            install.Enabled = false;
            secondary.Enabled = false;
            retry.Enabled = false;
            configureInstallation.Enabled = false;
            openApplication.Enabled = false;
            removeApplication.Enabled = false;
            bool started = false;
            try
            {
                string uninstaller = await Task.Run(() =>
                {
                    string root = SetupInstallation.RootFor(expected);
                    string path = Path.Combine(root, "IWXA.SetupCore.Uninstall.exe");
                    if (!File.Exists(path))
                        throw new InvalidOperationException(
                            "SETUP_OWNED_UNINSTALLER_MISSING");
                    BundleInfo owned = BundleReader.Inspect(path);
                    if (owned.Id != expected.Id ||
                        owned.Entrypoint != expected.Entrypoint)
                        throw new InvalidOperationException(
                            "SETUP_OWNED_UNINSTALLER_WRONG_PRODUCT");
                    return path;
                });
                // Keep old installed uninstaller binaries functional. They
                // recognize --uninstall but not the new optional mask.
                string arguments = optionalRemoval == 0 ?
                    "--uninstall" : "--uninstall " + optionalRemoval;
                using (Process worker = Process.Start(new ProcessStartInfo(
                    uninstaller, arguments) {
                    UseShellExecute = true,
                    WorkingDirectory = Path.GetDirectoryName(uninstaller)
                }))
                {
                    if (worker == null)
                        throw new InvalidOperationException(
                            "SETUP_UNINSTALL_PROCESS_NOT_STARTED");
                }
                started = true;
            }
            catch (Exception ex)
            {
                SetTechnicalReport(expected, inspectedStatus, ex.Message);
                status.Text = T("Не удалось начать удаление",
                    "Could not start uninstallation");
                packageDetails.Text = T(
                    "Проверьте файлы программы. При необходимости восстановите установку и повторите удаление.",
                    "Check the application files. Repair the installation if needed, then try uninstalling again.");
                status.ForeColor = Color.FromArgb(170, 52, 59);
            }
            finally
            {
                performingOperation = false;
                busyProgress.Visible = false;
                removeApplication.Enabled = removeApplication.Visible;
                openApplication.Enabled = true;
                configureInstallation.Enabled = configureInstallation.Visible;
                retry.Enabled = true;
                install.Enabled = primaryAction != SetupOperation.None;
                secondary.Enabled = secondaryAction != SetupOperation.None;
            }
            // The installed uninstaller owns the operation and shows its
            // result. Do not claim successful removal before its own readback.
            if (started) Close();
        }

        private void OpenRelatedAction()
        {
            // The application must not be launched by the setup surface while
            // files are being moved, updated, restored or inspected.
            if (performingOperation || verifyingState) return;
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
                packageDetails.Text = T(
                    "Проверьте установленную программу и повторите попытку.",
                    "Check the installed application and try again.");
                SetTechnicalReport(inspectedBundle, inspectedStatus, ex.Message);
            }
        }

        // Native completion is a claim, not evidence of the installed state.
        // Keep this table independent from the UI labels, so all outcomes
        // must match a fresh UpgradeAssessment after the operation.
        internal static bool CompletionMatches(
            string operation, string nativeOutcome, string observedPlan)
        {
            if (String.IsNullOrEmpty(operation) ||
                String.IsNullOrEmpty(nativeOutcome) ||
                String.IsNullOrEmpty(observedPlan)) return false;
            switch (operation)
            {
                case "Install":
                    return (nativeOutcome == "INSTALLED_NOT_LAUNCHED" ||
                            nativeOutcome == "INSTALLED_WITH_VERIFIED_DATA") &&
                        observedPlan == "REPAIR_CANDIDATE_NOT_ACTIVATED";
                case "Upgrade":
                    return nativeOutcome == "UPGRADED_BACKUP_RETAINED" &&
                        observedPlan == "UPGRADE_PENDING_CONFIRMATION";
                case "Repair":
                    return nativeOutcome == "REPAIRED_BACKUP_RETAINED" &&
                        (observedPlan == "UPGRADE_PENDING_CONFIRMATION" ||
                         observedPlan == "REPAIR_PENDING_CONFIRMATION_NO_ROLLBACK");
                case "Confirm":
                    return nativeOutcome == "UPGRADE_CONFIRMED_OLD_RELEASE_REMOVED" &&
                        observedPlan == "REPAIR_CANDIDATE_NOT_ACTIVATED";
                case "Rollback":
                    return (nativeOutcome == "ROLLBACK_RESTORED_PREVIOUS" ||
                            nativeOutcome == "ROLLBACK_RESTORED_USER_FILES_QUARANTINED") &&
                        (observedPlan == "UPGRADE_CANDIDATE_NOT_ACTIVATED" ||
                         observedPlan == "REPAIR_CANDIDATE_NOT_ACTIVATED");
                case "Recover":
                    return (nativeOutcome == "RECOVERED_PREVIOUS_RELEASE" &&
                            (observedPlan == "UPGRADE_CANDIDATE_NOT_ACTIVATED" ||
                             observedPlan == "REPAIR_CANDIDATE_NOT_ACTIVATED")) ||
                           (nativeOutcome == "UPGRADE_PENDING_CONFIRMATION" &&
                            observedPlan == "UPGRADE_PENDING_CONFIRMATION");
                case "StageLegacyPreview":
                    return nativeOutcome == "LEGACY_MIGRATION_STAGED_NSIS_PRESERVED" &&
                        observedPlan == "LEGACY_MIGRATION_PENDING_GUI_READBACK";
                case "CancelLegacyPreview":
                    return nativeOutcome == "UNINSTALLED_USER_DATA_PRESERVED" &&
                        observedPlan == "LEGACY_MIGRATION_HOLD";
                case "ActivateLegacyDefault":
                    return nativeOutcome == "LEGACY_DEFAULT_ACTIVE_NSIS_PRESERVED" &&
                        observedPlan == "LEGACY_DEFAULT_ACTIVE_NSIS_PRESERVED";
                case "RestoreLegacyDefault":
                    return nativeOutcome == "LEGACY_DEFAULT_RESTORED_NSIS_PRESERVED" &&
                        observedPlan == "LEGACY_MIGRATION_PENDING_GUI_READBACK";
                case "InstallWebView2":
                case "InstallWebView2Offline":
                    // A valid Runtime does not prove that an installed product
                    // or its ownership is healthy. Refuse a false success if
                    // the fresh disk plan is blocked, damaged or unknown.
                    if (nativeOutcome != "WEBVIEW2_ALREADY_INSTALLED" &&
                        nativeOutcome != "WEBVIEW2_INSTALLED_VERIFIED")
                        return false;
                    switch (observedPlan)
                    {
                        case "NO_OWNED_INSTALLATION":
                        case "REPAIR_CANDIDATE_NOT_ACTIVATED":
                        case "UPGRADE_CANDIDATE_NOT_ACTIVATED":
                        case "UPGRADE_PENDING_CONFIRMATION":
                        case "REPAIR_PENDING_CONFIRMATION_NO_ROLLBACK":
                        case "LEGACY_MIGRATION_HOLD":
                        case "LEGACY_MIGRATION_PENDING_GUI_READBACK":
                        case "LEGACY_DEFAULT_ACTIVE_NSIS_PRESERVED":
                        case "APPLICATION_RUNNING":
                            return true;
                        default: return false;
                    }
                default: return false;
            }
        }

        private async Task ExecuteAsync(SetupOperation operation)
        {
            if (performingOperation || verifyingState ||
                operation == SetupOperation.None) return;
            if (locationDraftChanged &&
                (operation == SetupOperation.Install ||
                 operation == SetupOperation.Upgrade ||
                 operation == SetupOperation.Repair))
            {
                ShowExperiencePage(1);
                MessageBox.Show(this,
                    T("Сначала примените выбранные папки и параметры запуска.",
                        "Apply your folder and startup settings first."),
                    T("Параметры установки", "Installation settings"),
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
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
            bool importExisting = operation == SetupOperation.Install &&
                inspectedBundle != null &&
                copyPriorData.Visible && copyPriorData.Checked &&
                selectedLocations != null &&
                SetupInstallation.HasPreservedDefaultData(
                    inspectedBundle, selectedLocations.DataRoot);
            if (importExisting)
            {
                string originalData = SetupInstallation.DefaultLocations(
                    inspectedBundle).DataRoot;
                DialogResult approved = MessageBox.Show(this,
                    T("Перенести прежние данные в выбранную папку?",
                      "Transfer existing data into the selected folder?") +
                    Environment.NewLine + Environment.NewLine +
                    T("Откуда: ", "From: ") + originalData +
                    Environment.NewLine +
                    T("Куда: ", "To: ") + selectedLocations.DataRoot +
                    Environment.NewLine + Environment.NewLine +
                    T("Сначала проверим место, затем скопируем и проверим файлы. Прежние данные останутся на месте. Не запускайте старую программу до завершения.",
                      "Space will be checked, then files copied and verified. Originals are kept. Do not start the older application until this finishes."),
                    T("Перенос существующих данных", "Transfer existing data"),
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2);
                if (approved != DialogResult.Yes) return;
            }
            if (operation == SetupOperation.ActivateLegacyDefault)
            {
                DialogResult approve = MessageBox.Show(
                    T("Вы открыли пробную версию и проверили организации, проекты и сохранённые данные?\nМы переключим только ярлык меню «Пуск» на новую версию. Прежняя программа и её деинсталлятор останутся нетронутыми; прежний запуск можно вернуть.",
                      "Have you opened the preview and checked your organizations, projects and data?\nOnly the Start Menu shortcut will switch to the new version. The previous application and its uninstaller stay intact, and the original shortcut can be restored."),
                    T("Подтвердить переключение запуска",
                      "Confirm Start Menu handoff"),
                    MessageBoxButtons.YesNo, MessageBoxIcon.Warning,
                    MessageBoxDefaultButton.Button2);
                if (approve != DialogResult.Yes) return;
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
            var importCancellation = importExisting ?
                new System.Threading.CancellationTokenSource() : null;
            if (importCancellation != null)
            {
                storageCancellation = importCancellation;
                cancelStorageMove.Visible = true;
                cancelStorageMove.Enabled = true;
            }
            FocusOperationProgress();
            performingOperation = true;
            busyProgress.Visible = true;
            RefreshExperienceButtons();
            install.Enabled = false;
            secondary.Enabled = false;
            retry.Enabled = false;
            openApplication.Enabled = false;
            configureInstallation.Enabled = false;
            removeApplication.Enabled = false;
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
                operation == SetupOperation.ActivateLegacyDefault ?
                T("Переключение ярлыка на новую версию…",
                  "Switching the Start Menu shortcut…") :
                operation == SetupOperation.RestoreLegacyDefault ?
                T("Возврат ярлыка на прежнюю версию…",
                  "Restoring the original Start Menu shortcut…") :
                operation == SetupOperation.InstallWebView2 ||
                operation == SetupOperation.InstallWebView2Offline ?
                T("Установка Microsoft WebView2…",
                  "Installing Microsoft WebView2…") :
                T("Установка проверенных файлов…", "Installing verified files…");
            Exception failure = null;
            bool completedSuccessfully = false;
            try
            {
                InstallOutcome result = await Task.Run(() =>
                {
                    string executable = Application.ExecutablePath;
                    SetupLocations selected = selectedLocations;
                    switch (operation)
                    {
                        case SetupOperation.Install:
                            if (!importExisting)
                                return SetupInstallation.InstallFresh(
                                    executable, selected);
                            return SetupInstallation.InstallFreshWithExistingData(
                                executable, selected, importCancellation.Token,
                                (copied, total) => {
                                    if (IsDisposed || Disposing || !IsHandleCreated)
                                        return;
                                    try
                                    {
                                        BeginInvoke((Action)(() => {
                                            if (IsDisposed || Disposing) return;
                                            int percent = total <= 0 ? 100 :
                                                (int)Math.Max(0, Math.Min(100,
                                                    copied * 100.0 / total));
                                            busyProgress.Style =
                                                ProgressBarStyle.Continuous;
                                            busyProgress.Value = percent;
                                            status.Text = T(
                                                "Переносим данные: ",
                                                "Transferring data: ") +
                                                percent + "%";
                                        }));
                                    }
                                    catch (InvalidOperationException) { }
                                    catch (ObjectDisposedException) { }
                                });
                        case SetupOperation.Upgrade: return SetupInstallation.UpgradeOwned(executable);
                        case SetupOperation.Repair: return SetupInstallation.RepairOwned(executable);
                        case SetupOperation.Recover: return SetupInstallation.RecoverOwned(executable);
                        case SetupOperation.Rollback: return SetupInstallation.RollbackOwned(executable);
                        case SetupOperation.Confirm: return SetupInstallation.ConfirmUpgrade(executable);
                        case SetupOperation.StageLegacyPreview:
                            return SetupInstallation.StageLegacy(executable);
                        case SetupOperation.CancelLegacyPreview:
                            return SetupInstallation.UninstallOwned(executable);
                        case SetupOperation.ActivateLegacyDefault:
                            return SetupInstallation.ActivateLegacyDefault(executable);
                        case SetupOperation.RestoreLegacyDefault:
                            return SetupInstallation.RestoreLegacyDefault(executable);
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
                UpgradeAssessment verified = await VerifyAsync(true);
                if (IsDisposed || Disposing) return;
                if (verified == null ||
                    !CompletionMatches(operation.ToString(), result.Status,
                        verified.Status))
                    throw new InvalidOperationException(
                        "SETUP_POST_OPERATION_STATE_UNCONFIRMED");
                if (operation == SetupOperation.InstallWebView2 ||
                    operation == SetupOperation.InstallWebView2Offline)
                {
                    if (String.IsNullOrWhiteSpace(
                        SetupReadiness.DetectWebView2Version()))
                        throw new InvalidOperationException(
                            "SETUP_POST_WEBVIEW2_RUNTIME_UNCONFIRMED");
                }
                else
                {
                    BundleInfo expected = await Task.Run(() =>
                        BundleReader.Inspect(Application.ExecutablePath));
                    if (operation == SetupOperation.CancelLegacyPreview)
                        await Task.Run(() =>
                            SetupInstallation.VerifyUninstalledState(expected));
                    else
                        await Task.Run(() =>
                            SetupInstallation.VerifyInstalledState(expected));
                }
                if (operation == SetupOperation.Upgrade)
                    status.Text = T("Новая версия установлена — проверьте запуск",
                        "Update installed — verify the application");
                else if (operation == SetupOperation.Repair)
                    status.Text = T("Файлы восстановлены — проверьте запуск",
                        "Files restored — verify the application");
                else if (operation == SetupOperation.Install)
                    status.Text = result.Status == "INSTALLED_WITH_VERIFIED_DATA" ?
                        T("Программа и прежние данные готовы",
                          "Application and existing data are ready") :
                        T("Приложение установлено", "Application installed");
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
                else if (operation == SetupOperation.ActivateLegacyDefault)
                    status.Text = T("Запуск переключён — прежняя программа сохранена",
                        "Start Menu switched — previous application preserved");
                else if (operation == SetupOperation.RestoreLegacyDefault)
                    status.Text = T("Прежний ярлык восстановлен",
                        "Original Start Menu shortcut restored");
                else if (operation == SetupOperation.InstallWebView2 ||
                         operation == SetupOperation.InstallWebView2Offline)
                    status.Text = T("WebView2 готов — можно установить программу",
                        "WebView2 ready — application can now be installed");
                status.ForeColor = Color.FromArgb(24, 119, 91);
                completedSuccessfully = true;
            }
            catch (Exception ex)
            {
                // C# 5 native compiler cannot await inside a catch block.
                failure = ex;
            }
            finally
            {
                performingOperation = false;
                busyProgress.Visible = false;
                busyProgress.Style = ProgressBarStyle.Marquee;
                cancelStorageMove.Visible = false;
                cancelStorageMove.Enabled = false;
                if (importCancellation != null)
                {
                    if (storageCancellation == importCancellation)
                        storageCancellation = null;
                    importCancellation.Dispose();
                }
                retry.Enabled = true;
                openApplication.Enabled = true;
                configureInstallation.Enabled = true;
                removeApplication.Enabled = removeApplication.Visible;
                // Actions remain locked throughout operation + post-readback.
                install.Enabled = primaryAction != SetupOperation.None;
                secondary.Enabled = secondaryAction != SetupOperation.None;
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
                    version.Text = T("Установка компонента не завершена",
                        "Component installation incomplete");
                    SetTechnicalReport(inspectedBundle, inspectedStatus, code);
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
                else if (failure.Message == "SETUP_FIRST_INSTALL_DATA_COPY_INCOMPLETE" ||
                         failure.Message == "SETUP_FIRST_INSTALL_DATA_COPY_CANCELLED")
                {
                    status.Text = T("Программа установлена, перенос не завершён",
                        "Application installed, transfer incomplete");
                    version.Text = T("Прежние данные сохранены",
                        "Original data is preserved");
                    packageDetails.Text = T(
                        "Установка завершилась, но перенос остановился. Программа пока использует прежнюю папку данных. Укажите выбранную новую папку и нажмите «Применить», чтобы повторить проверяемый перенос.",
                        "Installation completed, but transfer stopped. The application still uses the original data folder. Select your new folder and press Apply to retry the verified transfer.");
                    if (selectedLocations != null &&
                        locationInputs[1] != null)
                    {
                        // The normal installed-product relocation route now
                        // doubles as the recovery action. Keep the person's
                        // chosen destination rather than losing their edits.
                        locationInputs[1].Text = selectedLocations.DataRoot;
                    }
                }
                else if (failure.Message == "SETUP_STORAGE_TARGET_NOT_EMPTY_OR_EXISTS")
                {
                    status.Text = T("Папка для переноса занята",
                        "Data transfer folder is already in use");
                    packageDetails.Text = T(
                        "В выбранной папке уже есть файлы. Укажите новую пустую папку для переноса, чтобы не перезаписать существующие данные.",
                        "The chosen destination already contains files. Select a new empty folder for transfer to avoid overwriting existing data.");
                }
                else if (failure.Message.StartsWith(
                    "SETUP_STORAGE_DISK_SPACE_INSUFFICIENT", StringComparison.Ordinal))
                {
                    status.Text = T("Для переноса недостаточно места",
                        "Not enough space to transfer data");
                    packageDetails.Text = T(
                        "Нужно больше места для проверенной копии прежних данных. Выберите другой диск или продолжите установку без переноса.",
                        "The verified copy requires more free space. Choose another drive or install without importing old data.");
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
                    version.Text = T("Проверьте установленную программу",
                        "Check the installed application");
                    packageDetails.Text = T(
                        "Проверьте состояние установки и используйте доступное действие восстановления.",
                        "Review the installation state and use the available recovery action.");
                }
                SetTechnicalReport(inspectedBundle, inspectedStatus,
                    failure.Message);
                status.ForeColor = Color.FromArgb(170, 52, 59);
            }
            RefreshExperienceButtons();
            if (completedSuccessfully && launchAfterSetup.Checked &&
                (operation == SetupOperation.Install ||
                 operation == SetupOperation.Upgrade ||
                 operation == SetupOperation.Repair))
                OpenRelatedAction();
        }

        private async Task<UpgradeAssessment> VerifyAsync(
            bool fromOperation = false)
        {
            if (verifyingState || (performingOperation && !fromOperation))
                return null;
            verifyingState = true;
            busyProgress.Visible = true;
            retry.Enabled = false;
            openApplication.Enabled = false;
            SetWizardStep(1);
            ConfigureActions(SetupOperation.None, SetupOperation.None,
                T("Недоступно", "Unavailable"));
            openApplication.Visible = false;
            removeApplication.Visible = false;
            technicalDetails.Visible = false;
            configureInstallation.Visible = false;
            status.Text = T("Проверка целостности…", "Verifying integrity…");
            status.ForeColor = Dark;
            version.Text = "—";
            packageDetails.Text = "";
            try
            {
                BundleInfo info = await Task.Run(
                    () => BundleReader.Inspect(Application.ExecutablePath));
                UpgradeAssessment plan = await Task.Run(
                    () => SetupInstallation.PlanUpgrade(info));
                inspectedBundle = info;
                inspectedStatus = plan.Status;
                if (selectedLocations == null)
                    selectedLocations = SetupInstallation.InstalledLocations(info);
                if (IsDisposed || Disposing) return null;
                bool readyForReview =
                    plan.Status == "UPGRADE_PENDING_CONFIRMATION" ||
                    plan.Status == "REPAIR_PENDING_CONFIRMATION_NO_ROLLBACK" ||
                    plan.Status == "LEGACY_MIGRATION_PENDING_GUI_READBACK" ||
                    plan.Status == "LEGACY_DEFAULT_ACTIVE_NSIS_PRESERVED";
                SetWizardStep(readyForReview ? 3 : 2);
                configureInstallation.Visible =
                    plan.Status == "NO_OWNED_INSTALLATION" ||
                    AllowsOwnedUninstall(plan.Status) ||
                    plan.Status == "UPGRADE_CANDIDATE_NOT_ACTIVATED" ||
                    readyForReview;
                configureInstallation.Enabled = !performingOperation;
                // Only verified installed-product states can offer removal.
                // Pending upgrade/legacy handoff is resolved first.
                removeApplication.Visible = AllowsOwnedUninstall(plan.Status);
                removeApplication.Enabled = !performingOperation;

                productName.Text = info.Name;
                productName.AccessibleName = info.Name;
                Text = info.Name + " — IWXA Setup";
                string versionLine =
                    String.IsNullOrWhiteSpace(plan.InstalledVersion) ?
                    T("Версия в пакете: ", "Package version: ") + info.Version :
                    T("Установлено: ", "Installed: ") + plan.InstalledVersion +
                    T("    ·    В пакете: ", "    ·    Package: ") + info.Version;
                SetTechnicalReport(info, plan.Status, null);

                if (plan.Status == "NO_OWNED_INSTALLATION")
                {
                    InstallPreflight check = SetupReadiness.Check(info,
                        selectedLocations.ProgramRoot);
                    if (check.Status == "READY_FOR_FIRST_INSTALL")
                    {
                        string unavailable =
                            SetupInstallation.UnavailableStorageVolume(selectedLocations);
                        if (!String.IsNullOrWhiteSpace(unavailable))
                        {
                            SetState(T("Диск недоступен", "Drive unavailable"),
                                T("Папка данных или компонентов находится на отключённом диске ",
                                    "A data or component folder is on an unavailable drive ") +
                                unavailable +
                                T(". Подключите диск или измените папку.",
                                    ". Reconnect it or choose another folder."),
                                versionLine, true);
                            SetTechnicalReport(info, plan.Status,
                                "Storage volume unavailable: " + unavailable);
                        }
                        else
                        {
                            bool startupConflict = false;
                            try
                            {
                                SetupInstallation.EnsureStartupAvailable(info,
                                    selectedLocations.ProgramRoot,
                                    selectedLocations.StartWithWindows);
                            }
                            catch (InvalidOperationException ex)
                            {
                                if (ex.Message != "SETUP_STARTUP_SHORTCUT_CONFLICT")
                                    throw;
                                startupConflict = true;
                            }
                            if (startupConflict)
                            {
                                SetState(T("Проверьте автозапуск Windows",
                                        "Review Windows startup"),
                                    T("В папке автозагрузки уже есть другой ярлык с таким именем. Выключите автозапуск в параметрах или сохраните и переименуйте существующий ярлык.",
                                      "Another shortcut with this name exists in Windows Startup. Disable automatic startup in settings or save and rename the existing shortcut."),
                                    versionLine, true);
                                SetTechnicalReport(info, plan.Status,
                                    "SETUP_STARTUP_SHORTCUT_CONFLICT");
                            }
                            else
                            {
                                SetupDiskPlan disk = SetupInstallation.CheckStageSpace(info,
                                    selectedLocations.ProgramRoot);
                                if (disk.Status == "DISK_SPACE_READY")
                                {
                                    SetState(T("Готово к установке", "Ready to install"),
                                        T("Программа: ", "Application: ") +
                                        selectedLocations.ProgramRoot + Environment.NewLine +
                                        T("Данные: ", "Data: ") + selectedLocations.DataRoot,
                                        versionLine, false);
                                    ConfigureActions(SetupOperation.Install, SetupOperation.None,
                                        T("Установить", "Install"));
                                }
                                else ShowDiskSpaceRequired(disk, versionLine);
                            }
                        }
                    }
                    else if (check.Status == "WEBVIEW2_MISSING")
                    {
                        OfferWebView2Recovery(versionLine, false);
                    }
                    else
                    {
                        SetState(T("Требуется подготовка Windows", "Windows preparation needed"),
                            ExplainBlockedState(check.Status), versionLine, true);
                        SetTechnicalReport(info, plan.Status, "Preflight: " + check.Status);
                    }
                }
                else if (plan.Status == "WEBVIEW2_MISSING")
                {
                    // PlanUpgrade returns this for an owned installed product
                    // when its WebView2 Runtime is no longer available.
                    OfferWebView2Recovery(versionLine, true);
                }
                else if (plan.Status == "START_MENU_SHORTCUT_CONFLICT")
                {
                    SetState(T("Ярлык меню «Пуск» уже существует",
                               "Start Menu shortcut already exists"),
                        T("Нельзя подтвердить принадлежность существующего ярлыка. Он не будет перезаписан. Сохраните или переименуйте его и повторите проверку.",
                          "The existing shortcut is not owned by this installation and will not be overwritten. Save or rename it, then verify again."),
                        versionLine, true);
                    ConfigureActions(SetupOperation.None, SetupOperation.None,
                        T("Установка заблокирована", "Installation blocked"));
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
                else if (plan.Status == "UPGRADE_PENDING_CONFIRMATION" ||
                         plan.Status == "REPAIR_PENDING_CONFIRMATION_NO_ROLLBACK")
                {
                    bool incompleteRepair =
                        plan.Status == "REPAIR_PENDING_CONFIRMATION_NO_ROLLBACK";
                    SetState(incompleteRepair ?
                            T("Файлы восстановлены — проверьте программу",
                              "Files restored — verify the application") :
                            T("Проверьте новую версию", "Verify the updated version"),
                        incompleteRepair ?
                            T("Откройте восстановленную программу и проверьте данные. Прежняя копия была неполной, поэтому возвращать повреждённые файлы нельзя. Подтвердите успешное восстановление.",
                              "Open the repaired application and verify your data. The previous backup was incomplete and cannot safely be restored. Confirm the repair.") :
                            T("Откройте приложение, проверьте данные. Затем подтвердите обновление или верните прежнюю версию.",
                              "Open the application and check your data. Then confirm the update or roll back."),
                        versionLine, true);
                    ConfigureActions(SetupOperation.Confirm,
                        incompleteRepair ? SetupOperation.None : SetupOperation.Rollback,
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
                    bool entrypointMissing = !File.Exists(Path.Combine(
                        SetupInstallation.RootFor(info),
                        info.Entrypoint.Replace('/', Path.DirectorySeparatorChar)));
                    SetupDiskPlan disk = SetupInstallation.CheckStageSpace(info);
                    if (disk.Status != "DISK_SPACE_READY")
                    {
                        ShowDiskSpaceRequired(disk, versionLine);
                        // Disk pressure must not hide the already usable app.
                        openApplication.Tag = "APPLICATION";
                        openApplication.Text = T("Открыть установленную программу",
                            "Open installed application");
                        openApplication.Visible = !entrypointMissing;
                    }
                    else
                    {
                    SetState(entrypointMissing ?
                            T("Файлы программы отсутствуют — доступно восстановление",
                              "Application files missing — repair available") :
                            T("Эта версия уже установлена", "This version is installed"),
                        T("Восстановление заменит отсутствующие или повреждённые файлы программы. Личные данные останутся без изменений.",
                          "Repair restores missing or damaged application files without changing personal data."),
                        versionLine, entrypointMissing);
                    ConfigureActions(SetupOperation.Repair, SetupOperation.None,
                        T("Восстановить файлы", "Repair files"));
                    openApplication.Tag = "APPLICATION";
                    openApplication.Text = T("Открыть установленную программу",
                        "Open installed application");
                    openApplication.Visible = !entrypointMissing;
                    }
                }
                else if (plan.Status == "SAME_VERSION_DIFFERENT_PACKAGE" ||
                         plan.Status == "DOWNGRADE_BLOCKED" ||
                         plan.Status == "VERSION_UNSUPPORTED")
                {
                    bool differentBuild =
                        plan.Status == "SAME_VERSION_DIFFERENT_PACKAGE";
                    SetState(differentBuild ?
                        T("Установлена другая сборка", "A different build is installed") :
                        T("На компьютере уже есть программа",
                            "An application is already installed"),
                        differentBuild ?
                            T("Это установщик другого выпуска с тем же номером версии. Установленная программа остаётся доступной: измените папки и запуск, откройте её собственное восстановление или удалите программу в разделе «Обслуживание».",
                              "This installer belongs to another build of the same version. You can still change folders and startup, open the installed build's own repair, or uninstall under Maintenance.") :
                            T("Этот пакет не заменит установленную программу. Управление папками, восстановление из её собственного пакета и удаление доступны в разделе «Обслуживание».",
                              "This package cannot replace the installed application. Manage folders, open the installed package for repair, or uninstall under Maintenance."),
                        versionLine, true);
                    ConfigureActions(SetupOperation.None, SetupOperation.None,
                        T("Нужен другой пакет", "Another package needed"));
                    openApplication.Tag = "APPLICATION";
                    openApplication.Text = T("Открыть установленную программу",
                        "Open installed application");
                    string ownedApp = Path.Combine(
                        SetupInstallation.RootFor(info),
                        info.Entrypoint.Replace('/',
                            Path.DirectorySeparatorChar));
                    openApplication.Visible = File.Exists(ownedApp);
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
                            T("Прежнюю установку не удалось подтвердить. Сначала восстановите её или обратитесь к владельцу программы.",
                              "The existing installation could not be verified. Repair it first or contact the software publisher."),
                            versionLine, true);
                        SetTechnicalReport(info, plan.Status, old.Status);
                    }
                }
                else if (plan.Status == "LEGACY_MIGRATION_PENDING_GUI_READBACK")
                {
                    SetState(T("Пробная версия " + info.Version + " установлена",
                            "Preview version " + info.Version + " is installed"),
                        T("Откройте пробную версию и проверьте данные. Прежняя программа сохранена; переход можно отменить.",
                          "Open the preview and verify your data. The existing application is retained; you may cancel this preview."),
                        versionLine, true);
                    ConfigureActions(SetupOperation.ActivateLegacyDefault,
                        SetupOperation.CancelLegacyPreview,
                        T("Переключить запуск", "Use new version by default"));
                    openApplication.Tag = "APPLICATION";
                    openApplication.Text = T("Открыть пробную " + info.Version,
                        "Open preview " + info.Version);
                    openApplication.Visible = true;
                }
                else if (plan.Status == "LEGACY_DEFAULT_ACTIVE_NSIS_PRESERVED")
                {
                    SetState(T("Основной запуск переключён на " + info.Version,
                               "Start Menu now launches " + info.Version),
                        T("Прежняя программа и данные не удалены. В любой момент верните старый ярлык до окончательной приёмки.",
                          "The previous application and user data remain intact. You can restore the old shortcut before final acceptance."),
                        versionLine, true);
                    ConfigureActions(SetupOperation.RestoreLegacyDefault,
                        SetupOperation.None, T("Вернуть старый запуск", "Restore old shortcut"));
                    openApplication.Tag = "APPLICATION";
                    openApplication.Text = T("Открыть новую версию", "Open new version");
                    openApplication.Visible = true;
                }
                else if (plan.Status == "LEGACY_SWITCH_RECOVERY_REQUIRED")
                {
                    SetState(T("Переключение запуска было прервано",
                               "Start Menu switch was interrupted"),
                        T("Старые файлы и данные сохранены. Верните исходный ярлык, затем повторите проверку.",
                          "Old files and data are preserved. Restore the original shortcut, then verify again."),
                        versionLine, true);
                    ConfigureActions(SetupOperation.RestoreLegacyDefault,
                        SetupOperation.None, T("Восстановить прежний ярлык",
                                              "Recover old shortcut"));
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
                        ExplainBlockedState(plan.Status), versionLine, true);
                }
                RefreshExperience(info, plan);
                return plan;
            }
            catch (Exception ex)
            {
                if (IsDisposed || Disposing) return null;
                status.Text = T("Пакет не подтверждён", "Package not verified");
                status.ForeColor = Color.FromArgb(170, 52, 59);
                version.Text = T("Не удалось проверить пакет",
                    "Package verification could not finish");
                packageDetails.Text = T(
                    "Установка пока недоступна. Проверьте дистрибутив и повторите попытку.",
                    "Installation is unavailable. Check the installer and try again.");
                SetTechnicalReport(inspectedBundle, inspectedStatus, ex.Message);
                return null;
            }
            finally
            {
                verifyingState = false;
                if (!IsDisposed && !Disposing)
                {
                    // The caller keeps the form busy until the complete
                    // ownership readback finishes, even after VerifyAsync.
                    if (!performingOperation) busyProgress.Visible = false;
                    retry.Enabled = !performingOperation;
                    openApplication.Enabled = !performingOperation &&
                        openApplication.Visible;
                    install.Enabled = !performingOperation &&
                        primaryAction != SetupOperation.None;
                    secondary.Enabled = !performingOperation &&
                        secondaryAction != SetupOperation.None;
                    configureInstallation.Enabled = !performingOperation &&
                        configureInstallation.Visible;
                    removeApplication.Enabled = !performingOperation &&
                        removeApplication.Visible;
                    RefreshExperienceButtons();
                }
            }
        }

    }
}

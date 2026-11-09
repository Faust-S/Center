using System;
using System.Drawing;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace IwxaSetup
{
    // User-facing state and commands for the single native Setup surface.
    // Actions reuse SetupInstallation; no duplicate installer or storage engine.
    internal sealed partial class SetupForm
    {
        private readonly TextBox[] locationInputs = new TextBox[5];
        private readonly TextBox locationSummary = new TextBox();
        private readonly TextBox commonStorageInput = new TextBox();
        private readonly CheckBox launchAtLogin = new CheckBox();
        private readonly CheckBox launchAfterSetup = new CheckBox();
        private readonly Button applyLocations = new Button();
        private readonly Button discardLocations = new Button();
        private readonly Button serviceOwnedSetup = new Button();
        private int selectedRemovalMask;
        private Button programBrowse;
        private readonly Button webOnline = new Button();
        private readonly Button webOffline = new Button();
        private readonly Label componentStatus = new Label();
        private readonly Label journeyStage = new Label();
        private readonly Label draftNotice = new Label();
        private bool updatingLocationInputs;
        private bool commonEditedByUser;
        private bool locationDraftChanged;

        private void BuildExperienceLayout()
        {
            BuildUnifiedLayout();
        }

        private void ShowExperiencePage(int page)
        {
            if (page != 1 || performingOperation || verifyingState) return;
            if (unifiedCompact) OpenCompactSettings();
            else if (locationInputs[0] != null)
                locationInputs[0].Focus();
        }

        private void FocusOperationProgress()
        {
            FocusUnifiedProgress();
        }

        private void RefreshExperienceButtons()
        {
            RefreshUnifiedButtons();
        }

        private void RefreshExperience(BundleInfo info, UpgradeAssessment plan)
        {
            if (info == null || plan == null) return;
            bool initial = plan.Status == "NO_OWNED_INSTALLATION";
            journeyStage.Text = initial ?
                T("ПЕРВАЯ УСТАНОВКА", "FIRST INSTALL") :
                T("ОБСЛУЖИВАНИЕ ПРОГРАММЫ", "APPLICATION MAINTENANCE");
            description.Text = initial ?
                T("Настройте папки, выберите запуск и установите программу.",
                  "Choose folders and startup, then install.") :
                T("Обновление, восстановление и управление настройками.",
                  "Update, repair and change installation settings.");
            RefreshExperienceLocations(false);
            RefreshComponents();
            RefreshUnifiedButtons();
        }

        private void MarkLocationsChanged()
        {
            if (updatingLocationInputs) return;
            locationDraftChanged = true;
            draftNotice.Text = T("Изменения ещё не применены.",
                "Changes have not been applied.");
            RefreshExperienceButtons();
        }

        private void ApplyCommonStorage(string root)
        {
            if (String.IsNullOrWhiteSpace(root)) return;
            string normalized = Path.GetFullPath(root.Trim());
            updatingLocationInputs = true;
            try { commonStorageInput.Text = normalized; }
            finally { updatingLocationInputs = false; }
            commonEditedByUser = false;
            string[] parts = {"Data", "Software", "Models", "Cache"};
            for (int i = 1; i <= 4; i++)
                locationInputs[i].Text = Path.Combine(normalized, parts[i - 1]);
            MarkLocationsChanged();
        }

        private static string CommonLocation(SetupLocations paths)
        {
            if (paths == null || String.IsNullOrWhiteSpace(paths.DataRoot))
                return "";
            try
            {
                string parent = Path.GetDirectoryName(
                    Path.GetFullPath(paths.DataRoot));
                if (String.IsNullOrWhiteSpace(parent)) return "";
                string[] values = {paths.DataRoot, paths.SoftwareRoot,
                    paths.ModelsRoot, paths.CacheRoot};
                string[] names = {"Data", "Software", "Models", "Cache"};
                for (int i = 0; i < values.Length; i++)
                {
                    if (!String.Equals(Path.GetFullPath(values[i]),
                        Path.Combine(parent, names[i]),
                        StringComparison.OrdinalIgnoreCase))
                        return "";
                }
                return parent;
            }
            catch (ArgumentException) { return ""; }
            catch (NotSupportedException) { return ""; }
        }

        private void RefreshExperienceLocations(bool discard)
        {
            if (inspectedBundle == null || locationInputs[0] == null) return;
            SetupLocations paths;
            try
            {
                paths = inspectedStatus == "NO_OWNED_INSTALLATION" ?
                    selectedLocations : SetupInstallation.InstalledLocations(inspectedBundle);
                if (paths == null) return;
            }
            catch (Exception error)
            {
                SetTechnicalReport(inspectedBundle, inspectedStatus, error.Message);
                return;
            }
            if (!discard && locationDraftChanged) return;
            updatingLocationInputs = true;
            try
            {
                locationInputs[0].Text = paths.ProgramRoot;
                locationInputs[0].ReadOnly =
                    inspectedStatus != "NO_OWNED_INSTALLATION";
                if (programBrowse != null)
                    programBrowse.Enabled =
                        inspectedStatus == "NO_OWNED_INSTALLATION";
                for (int i = 1; i <= 4; i++)
                    locationInputs[i].Text = new [] {paths.DataRoot,
                        paths.SoftwareRoot, paths.ModelsRoot,
                        paths.CacheRoot}[i - 1];
                commonStorageInput.Text = CommonLocation(paths);
                commonEditedByUser = false;
                launchAtLogin.Checked = paths.StartWithWindows;
                launchAfterSetup.Enabled =
                    inspectedStatus == "NO_OWNED_INSTALLATION" ||
                    inspectedStatus == "UPGRADE_CANDIDATE_NOT_ACTIVATED";
                locationDraftChanged = false;
                draftNotice.Text = T("Параметры проверены.",
                    "Settings reflect the current installation.");
            }
            finally { updatingLocationInputs = false; }
            RefreshExperienceButtons();
        }

        private void RefreshComponents()
        {
            if (inspectedBundle == null) return;
            try
            {
                string version = SetupReadiness.DetectWebView2Version();
                bool required = inspectedBundle.NeedsWebView2;
                bool missing = String.IsNullOrWhiteSpace(version);
                componentStatus.Text = !required ?
                    T("Для этой программы WebView2 не требуется.",
                        "This application does not require WebView2.") :
                    missing ? T("WebView2 не установлен. Требуется для работы.",
                        "WebView2 is missing and required for this application.") :
                    T("Установлен WebView2, версия ", "WebView2 installed, version ") +
                        version;
                webOnline.Visible = required && missing;
                webOffline.Visible = required && missing;
                webOnline.Enabled = required && missing &&
                    !performingOperation && !verifyingState;
                webOffline.Enabled = webOnline.Enabled;
            }
            catch (Exception ex)
            {
                componentStatus.Text = T("Не удалось проверить WebView2.",
                    "Could not check WebView2.");
                webOnline.Enabled = webOffline.Enabled = false;
                webOnline.Visible = webOffline.Visible = false;
                SetTechnicalReport(inspectedBundle, inspectedStatus, ex.Message);
            }
        }

        private async Task SaveExperienceLocationsAsync()
        {
            if (inspectedBundle == null || performingOperation || verifyingState)
                return;
            BundleInfo info = inspectedBundle;
            bool first = inspectedStatus == "NO_OWNED_INSTALLATION";
            SetupLocations previous;
            try
            {
                previous = first ? selectedLocations :
                    SetupInstallation.InstalledLocations(info);
                var proposed = new SetupLocations {
                    ProgramRoot = locationInputs[0].Text,
                    DataRoot = locationInputs[1].Text,
                    SoftwareRoot = locationInputs[2].Text,
                    ModelsRoot = locationInputs[3].Text,
                    CacheRoot = locationInputs[4].Text,
                    StartWithWindows = launchAtLogin.Checked
                };
                SetupLocations validated = SetupInstallation.ValidateLocations(
                    info, proposed, first);
                if (!first && inspectedStatus == "APPLICATION_RUNNING" &&
                    (!String.Equals(previous.DataRoot, validated.DataRoot,
                          StringComparison.OrdinalIgnoreCase) ||
                     !String.Equals(previous.SoftwareRoot, validated.SoftwareRoot,
                          StringComparison.OrdinalIgnoreCase) ||
                     !String.Equals(previous.ModelsRoot, validated.ModelsRoot,
                          StringComparison.OrdinalIgnoreCase) ||
                     !String.Equals(previous.CacheRoot, validated.CacheRoot,
                          StringComparison.OrdinalIgnoreCase)))
                {
                    MessageBox.Show(this,
                        T("Закройте программу перед переносом файлов. Изменить автозапуск можно без переноса.",
                            "Close the application before moving files. You can change Windows startup without moving storage."),
                        T("Папки и запуск", "Folders and startup"),
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                bool applied = await ApplyOptionsAsync(info, previous, validated, first);
                if (!applied) return;
                if (first)
                    selectedLocations = validated;
                locationDraftChanged = false;
                RefreshExperienceLocations(true);
                RefreshExperienceButtons();
            }
            catch (Exception ex) { ShowLocationError(ex); }
        }

        private void ShowLocationError(Exception error)
        {
            SetTechnicalReport(inspectedBundle, inspectedStatus, error.Message);
            MessageBox.Show(this, ExplainStorageSettingsError(error),
                T("Папки и запуск", "Folders and startup"),
                MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }

        private void OpenInstalledMaintenance()
        {
            if (performingOperation || verifyingState ||
                inspectedBundle == null) return;
            try
            {
                string root = SetupInstallation.RootFor(inspectedBundle);
                string path = Path.Combine(root, "IWXA.SetupCore.Uninstall.exe");
                if (!File.Exists(path))
                    throw new InvalidOperationException("SETUP_OWNED_UNINSTALLER_MISSING");
                BundleInfo owned = BundleReader.Inspect(path);
                if (owned.Id != inspectedBundle.Id ||
                    owned.Entrypoint != inspectedBundle.Entrypoint)
                    throw new InvalidOperationException("SETUP_OWNERSHIP_MISMATCH");
                UpgradeAssessment installed = SetupInstallation.PlanUpgrade(owned);
                if (installed.Status != "REPAIR_CANDIDATE_NOT_ACTIVATED" &&
                    installed.Status != "WEBVIEW2_MISSING" &&
                    installed.Status != "APPLICATION_RUNNING")
                    throw new InvalidOperationException(
                        "SETUP_INSTALLED_MAINTENANCE_UNAVAILABLE");
                Process.Start(new ProcessStartInfo(path) {
                    UseShellExecute = true,
                    WorkingDirectory = root
                });
                Close();
            }
            catch (Exception ex)
            {
                SetTechnicalReport(inspectedBundle, inspectedStatus, ex.Message);
                MessageBox.Show(this,
                    T("Не удалось открыть обслуживание установленного выпуска. Проверьте его файлы и повторите попытку.",
                      "Could not open maintenance for the installed release. Check its files and retry."),
                    T("Обслуживание", "Maintenance"), MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        }

        // One confirmation dialog. No secondary pages or scrolling.
        // The previous installed release may only support app-only removal.
        private DialogResult ConfirmExperienceUninstall(BundleInfo info)
        {
            selectedRemovalMask = 0;
            SetupLocations locations = SetupInstallation.InstalledLocations(info);
            using (var dialog = new Form {
                Text = T("Удаление программы", "Uninstall application"),
                StartPosition = FormStartPosition.CenterParent,
                ClientSize = new Size(780, 460),
                MinimumSize = new Size(590, 365),
                AutoScaleMode = AutoScaleMode.Dpi,
                Font = new Font("Segoe UI", 9.5F),
                BackColor = Color.White,
                MaximizeBox = false
            })
            {
                var layout = new TableLayoutPanel {
                    Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5,
                    Padding = new Padding(22, 18, 22, 14),
                    BackColor = Color.White
                };
                layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
                foreach(float portion in new [] {14F, 14F, 10F, 47F, 15F})
                    layout.RowStyles.Add(new RowStyle(SizeType.Percent, portion));
                dialog.Controls.Add(layout);
                layout.Controls.Add(UiLabel(
                    T("Удалить ", "Uninstall ") + info.Name + "?",
                    16F, true), 0, 0);
                layout.Controls.Add(UiLabel(T(
                    "По умолчанию программа удаляется без личных данных. Отметьте только те папки, которые нужно удалить окончательно.",
                    "By default the application is removed without your data. Select only folders you want permanently deleted."),
                    9.5F, false, Secondary), 0, 1);
                layout.Controls.Add(UiLabel(T(
                    "Что делать с сохранёнными папками", "Stored files"),
                    11F, true), 0, 2);

                bool selective = false;
                try {
                    string installed = Path.Combine(
                        SetupInstallation.RootFor(info),
                        "IWXA.SetupCore.Uninstall.exe");
                    BundleInfo stored = BundleReader.Inspect(installed);
                    // A different installed release may not understand
                    // selection flags; it remains uninstallable with mask 0.
                    selective = String.Equals(info.PackageSha256,
                        stored.PackageSha256,
                        StringComparison.OrdinalIgnoreCase);
                } catch (Exception) { }
                var options = UiTable(2, 50, 50);
                options.RowCount = 2;
                options.RowStyles.Clear();
                options.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
                options.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
                layout.Controls.Add(options, 0, 3);
                int[] flags = {1, 2, 4, 8};
                string[] titles = {
                    T("Личные данные", "Personal data"),
                    T("Сторонние программы", "External software"),
                    T("Локальные модели", "Local models"),
                    T("Кэш", "Cache")
                };
                string[] paths = {locations.DataRoot,
                    locations.SoftwareRoot, locations.ModelsRoot,
                    locations.CacheRoot};
                var choices = new CheckBox[4];
                for (int i = 0; i < 4; i++)
                {
                    var group = new TableLayoutPanel {
                        Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2,
                        Padding = new Padding(4), Margin = new Padding(3),
                        BackColor = Color.FromArgb(247, 250, 254)
                    };
                    group.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
                    group.RowStyles.Add(new RowStyle(SizeType.Percent, 55));
                    group.RowStyles.Add(new RowStyle(SizeType.Percent, 45));
                    string block = SetupInstallation.CleanupBlockReason(info, flags[i]);
                    bool allowed = selective &&
                        String.IsNullOrWhiteSpace(block);
                    var checkbox = new CheckBox {
                        Name = "iwxaSetupRemoveStorage" + flags[i],
                        Text = titles[i], Checked = false,
                        Enabled = allowed, Dock = DockStyle.Fill,
                        Font = new Font("Segoe UI", 9.5F, FontStyle.Bold)
                    };
                    choices[i] = checkbox;
                    group.Controls.Add(checkbox, 0, 0);
                    string status = !selective ?
                        T("Сохранится: установленный выпуск без выбора данных.",
                          "Preserved by installed release.") :
                        allowed ? paths[i] :
                        T("Недоступно: общая или защищённая папка.",
                          "Unavailable: shared or protected location.");
                    var hint = UiLabel(status, 8.25F, false, Secondary);
                    hint.AutoEllipsis = true;
                    var tip = new ToolTip();
                    tip.SetToolTip(hint, paths[i]);
                    group.Controls.Add(hint, 0, 1);
                    options.Controls.Add(group, i % 2, i / 2);
                }

                var footer = UiTable(3, 34, 33, 33);
                layout.Controls.Add(footer, 0, 4);
                footer.Controls.Add(UiLabel(T(
                    "Общие папки других программ защищены.",
                    "Shared application folders are protected."),
                    8.5F, false, Secondary), 0, 0);
                var keep = new Button {
                    Text = T("Отмена", "Cancel"),
                    DialogResult = DialogResult.Cancel,
                    Dock = DockStyle.Fill, Margin = new Padding(5)
                };
                StyleSecondaryButton(keep);
                footer.Controls.Add(keep, 1, 0);
                var confirm = new Button {
                    Text = T("Удалить программу", "Uninstall application"),
                    Dock = DockStyle.Fill, Margin = new Padding(5),
                    ForeColor = Color.FromArgb(158, 45, 57)
                };
                StyleSecondaryButton(confirm);
                confirm.Click += (sender, args) => {
                    int mask = 0;
                    string summary = "";
                    for(int i=0;i<choices.Length;i++)
                        if (choices[i].Checked && choices[i].Enabled) {
                            mask |= flags[i];
                            summary += Environment.NewLine +
                                titles[i] + ": " + paths[i];
                        }
                    if (mask != 0 &&
                        MessageBox.Show(dialog,
                            T("Безвозвратно удалить выбранные папки?",
                              "Permanently delete the selected folders?") +
                            summary,
                            T("Подтверждение удаления данных",
                              "Confirm deletion"),
                            MessageBoxButtons.YesNo,
                            MessageBoxIcon.Warning,
                            MessageBoxDefaultButton.Button2) != DialogResult.Yes)
                        return;
                    selectedRemovalMask = mask;
                    dialog.DialogResult = DialogResult.Yes;
                };
                footer.Controls.Add(confirm, 2, 0);
                dialog.CancelButton = keep;
                dialog.Shown += (sender, args) =>
                    FitDialogToWorkingArea(dialog);
                return dialog.ShowDialog(this);
            }
        }
    }
}

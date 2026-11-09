using System;
using System.Drawing;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace IwxaSetup
{
    // One native Windows surface for first installation and installed-product
    // maintenance. All changes are carried out by the existing SetupInstallation.
    internal sealed partial class SetupForm
    {
        private readonly Panel[] experiencePages = new Panel[5];
        private readonly Button[] experienceNavigation = new Button[5];
        private readonly TextBox[] locationInputs = new TextBox[5];
        private readonly TextBox locationSummary = new TextBox();
        private readonly TextBox commonStorageInput = new TextBox();
        private readonly CheckBox launchAtLogin = new CheckBox();
        private readonly CheckBox launchAfterSetup = new CheckBox();
        private readonly Button applyLocations = new Button();
        private readonly Button discardLocations = new Button();
        private readonly Button servicePrimary = new Button();
        private readonly Button serviceSecondary = new Button();
        private readonly Button serviceOwnedSetup = new Button();
        private readonly Button openRemoval = new Button();
        private readonly Button overviewManage = new Button();
        private Button programBrowse;
        private FlowLayoutPanel experienceFooter;
        private readonly Button webOnline = new Button();
        private readonly Button webOffline = new Button();
        private readonly Button webRefresh = new Button();
        private readonly Label componentStatus = new Label();
        private readonly Label serviceExplanation = new Label();
        private readonly Label removalExplanation = new Label();
        private readonly Label journeyStage = new Label();
        private readonly Label draftNotice = new Label();
        private bool updatingLocationInputs;
        private bool commonEditedByUser;
        private bool locationDraftChanged;
        private int currentExperiencePage;

        private Label ExperienceLabel(string text, float size, Color color, bool bold)
        {
            return new Label {
                Text = text, AutoSize = false, Dock = DockStyle.Fill,
                ForeColor = color,
                Font = new Font("Segoe UI", size,
                    bold ? FontStyle.Bold : FontStyle.Regular),
                TextAlign = ContentAlignment.MiddleLeft
            };
        }

        private Button ExperienceButton(string name, string text, bool filled)
        {
            var button = new Button {
                Name = name, Text = text, AutoEllipsis = false,
                Font = new Font("Segoe UI", 10F,
                    filled ? FontStyle.Bold : FontStyle.Regular),
                Height = 40, FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand, UseVisualStyleBackColor = false,
                BackColor = filled ? Accent : Color.White,
                ForeColor = filled ? Color.White : Dark,
                AccessibleName = text
            };
            button.FlatAppearance.BorderSize = filled ? 0 : 1;
            button.FlatAppearance.BorderColor = Color.FromArgb(191, 203, 220);
            return button;
        }

        private static TableLayoutPanel ExperienceStack()
        {
            var layout = new TableLayoutPanel {
                Dock = DockStyle.Top, AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                ColumnCount = 1, RowCount = 0,
                Padding = new Padding(18, 14, 18, 18),
                BackColor = Color.White
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            return layout;
        }

        private static void Stack(TableLayoutPanel stack, Control control, int height)
        {
            int index = stack.RowCount++;
            stack.RowStyles.Add(new RowStyle(SizeType.Absolute, height));
            control.Margin = new Padding(0, 0, 0, 8);
            control.Dock = DockStyle.Fill;
            stack.Controls.Add(control, 0, index);
        }

        private Panel ExperiencePage()
        {
            var page = new Panel {
                Dock = DockStyle.Fill, AutoScroll = true,
                BackColor = Color.FromArgb(246, 249, 253),
                Margin = Padding.Empty, Visible = false
            };
            return page;
        }

        private Panel ExperienceCard()
        {
            return new Panel {
                BackColor = Color.White, Dock = DockStyle.Fill,
                Margin = new Padding(0, 0, 0, 12),
                Padding = new Padding(18)
            };
        }

        private void BuildExperienceLayout()
        {
            MinimumSize = new Size(820, 520);
            ClientSize = new Size(1120, 720);
            BackColor = Color.FromArgb(246, 249, 253);
            var frame = new TableLayoutPanel {
                Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1,
                Padding = Padding.Empty, Margin = Padding.Empty
            };
            frame.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 212F));
            frame.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            frame.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            Controls.Add(frame);

            var sidebar = new Panel {
                Dock = DockStyle.Fill, BackColor = Color.White,
                Margin = Padding.Empty, Padding = new Padding(14, 24, 14, 14)
            };
            frame.Controls.Add(sidebar, 0, 0);
            var sideStack = new TableLayoutPanel {
                Dock = DockStyle.Top, ColumnCount = 1, RowCount = 0,
                AutoSize = true, BackColor = Color.White
            };
            sideStack.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            sidebar.Controls.Add(sideStack);
            Stack(sideStack, ExperienceLabel("IWXA", 24, Dark, true), 52);
            Stack(sideStack, ExperienceLabel("SETUP CORE", 9,
                Secondary, false), 30);
            Stack(sideStack, ExperienceLabel(T("УПРАВЛЕНИЕ ПРОГРАММОЙ",
                "APPLICATION MANAGEMENT"), 8,
                Secondary, true), 45);
            string[] sections = {
                T("Обзор", "Overview"),
                T("Папки и запуск", "Folders and startup"),
                T("Обслуживание", "Maintenance"),
                T("Компоненты", "Components"),
                T("Удаление", "Uninstall")
            };
            for (int i = 0; i < sections.Length; i++)
            {
                int page = i;
                var nav = ExperienceButton("iwxaSetupNavigation" + i,
                    sections[i], false);
                nav.TextAlign = ContentAlignment.MiddleLeft;
                nav.Padding = new Padding(12, 0, 0, 0);
                nav.Height = 44;
                nav.BackColor = Color.White;
                nav.ForeColor = Dark;
                nav.FlatAppearance.BorderSize = 0;
                nav.Click += (sender, args) => ShowExperiencePage(page);
                Stack(sideStack, nav, 52);
                experienceNavigation[i] = nav;
            }
            var sideFooter = ExperienceLabel("IWXA  /  WINDOWS", 9,
                Secondary, false);
            sideFooter.Dock = DockStyle.Bottom;
            sideFooter.Height = 35;
            sidebar.Controls.Add(sideFooter);

            var body = new TableLayoutPanel {
                Name = "iwxaSetupMainSurface", Dock = DockStyle.Fill,
                ColumnCount = 1, RowCount = 3,
                BackColor = Color.FromArgb(246, 249, 253),
                Margin = Padding.Empty, Padding = Padding.Empty
            };
            body.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            body.RowStyles.Add(new RowStyle(SizeType.Absolute, 125F));
            body.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            body.RowStyles.Add(new RowStyle(SizeType.Absolute, 72F));
            frame.Controls.Add(body, 1, 0);

            var header = new TableLayoutPanel {
                Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 3,
                Padding = new Padding(28, 14, 26, 4)
            };
            header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 184F));
            header.RowStyles.Add(new RowStyle(SizeType.Absolute, 25F));
            header.RowStyles.Add(new RowStyle(SizeType.Absolute, 52F));
            header.RowStyles.Add(new RowStyle(SizeType.Absolute, 30F));
            body.Controls.Add(header, 0, 0);
            journeyStage.Text = T("ПРОГРАММА IWXA", "IWXA APPLICATION");
            journeyStage.ForeColor = Accent;
            journeyStage.Font = new Font("Segoe UI", 9F, FontStyle.Bold);
            journeyStage.Dock = DockStyle.Fill;
            header.Controls.Add(journeyStage, 0, 0);
            technicalDetails.Name = "iwxaSetupTechnicalDetails";
            technicalDetails.Text = T("Технические сведения", "Technical details");
            technicalDetails.LinkColor = Color.FromArgb(53, 90, 144);
            technicalDetails.TextAlign = ContentAlignment.MiddleRight;
            technicalDetails.Dock = DockStyle.Fill;
            technicalDetails.Visible = false;
            technicalDetails.LinkClicked += (sender, args) =>
            {
                if (String.IsNullOrWhiteSpace(technicalReport)) return;
                using (Form dialog = CreateTechnicalDetailsDialog())
                    dialog.ShowDialog(this);
            };
            header.Controls.Add(technicalDetails, 1, 0);
            productName.Name = "iwxaSetupProductTitle";
            productName.Text = T("Проверяем пакет", "Checking package");
            productName.Font = new Font("Segoe UI", 23F, FontStyle.Bold);
            productName.ForeColor = Dark;
            productName.Dock = DockStyle.Fill;
            productName.AutoEllipsis = true;
            header.Controls.Add(productName, 0, 1);
            header.SetColumnSpan(productName, 2);
            description.Text = T("Установка и управление программой в одном окне.",
                "Install and manage the application from one window.");
            description.ForeColor = Secondary;
            description.Dock = DockStyle.Fill;
            header.Controls.Add(description, 0, 2);
            header.SetColumnSpan(description, 2);

            var pages = new Panel {
                Dock = DockStyle.Fill, Margin = new Padding(28, 0, 26, 0),
                BackColor = Color.FromArgb(246, 249, 253)
            };
            body.Controls.Add(pages, 0, 1);
            for (int i = 0; i < experiencePages.Length; i++)
            {
                experiencePages[i] = ExperiencePage();
                pages.Controls.Add(experiencePages[i]);
            }
            BuildOverview();
            BuildInlineSettings();
            BuildMaintenance();
            BuildComponents();
            BuildRemoval();

            var footer = new FlowLayoutPanel {
                Name = "iwxaSetupActions",
                Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft,
                WrapContents = false, Padding = new Padding(20, 13, 20, 6),
                BackColor = Color.White
            };
            body.Controls.Add(footer, 0, 2);
            experienceFooter = footer;
            footer.SizeChanged += (sender, args) => ResizeExperienceFooter();
            install.Name = "iwxaSetupPrimaryAction";
            install.Size = new Size(185, 43);
            install.Margin = new Padding(5, 0, 5, 0);
            install.BackColor = Accent;
            install.ForeColor = Color.White;
            install.FlatStyle = FlatStyle.Flat;
            install.FlatAppearance.BorderSize = 0;
            install.Text = T("Установить", "Install");
            install.Enabled = false;
            install.Click += async (sender, args) => await ExecuteAsync(primaryAction);
            footer.Controls.Add(install);
            secondary.Name = "iwxaSetupAlternateAction";
            secondary.Size = new Size(160, 43);
            secondary.Margin = new Padding(5, 0, 5, 0);
            StyleSecondaryButton(secondary);
            secondary.Click += async (sender, args) => await ExecuteAsync(secondaryAction);
            footer.Controls.Add(secondary);
            retry.Name = "iwxaSetupRecheck";
            retry.Text = T("Проверить снова", "Check again");
            retry.Size = new Size(155, 43);
            retry.Margin = new Padding(5, 0, 5, 0);
            StyleSecondaryButton(retry);
            retry.Click += async (sender, args) => await VerifyAsync();
            footer.Controls.Add(retry);
            cancelStorageMove.Name = "iwxaSetupCancelStorageMove";
            cancelStorageMove.Text = T("Отменить перенос", "Cancel move");
            cancelStorageMove.Size = new Size(160, 43);
            cancelStorageMove.Margin = new Padding(5, 0, 5, 0);
            StyleSecondaryButton(cancelStorageMove);
            cancelStorageMove.Visible = false;
            cancelStorageMove.Click += (sender, args) =>
            {
                if (storageCancellation == null ||
                    storageCancellation.IsCancellationRequested) return;
                storageCancellation.Cancel();
                cancelStorageMove.Enabled = false;
                status.Text = T("Отменяем перенос", "Cancelling move");
            };
            footer.Controls.Add(cancelStorageMove);
            applyLocations.Name = "iwxaSetupApplyLocations";
            applyLocations.Text = T("Применить параметры", "Apply settings");
            applyLocations.Size = new Size(205, 43);
            applyLocations.Margin = new Padding(5, 0, 5, 0);
            applyLocations.BackColor = Accent;
            applyLocations.ForeColor = Color.White;
            applyLocations.FlatStyle = FlatStyle.Flat;
            applyLocations.FlatAppearance.BorderSize = 0;
            applyLocations.Click += async (sender, args) =>
                await SaveExperienceLocationsAsync();
            footer.Controls.Add(applyLocations);
            discardLocations.Name = "iwxaSetupDiscardLocations";
            discardLocations.Text = T("Вернуть значения", "Discard changes");
            discardLocations.Size = new Size(176, 43);
            discardLocations.Margin = new Padding(5, 0, 5, 0);
            StyleSecondaryButton(discardLocations);
            discardLocations.Click += (sender, args) => RefreshExperienceLocations(true);
            footer.Controls.Add(discardLocations);
            ShowExperiencePage(0);
        }

        private void ResizeExperienceFooter()
        {
            if (experienceFooter == null || experienceFooter.ClientSize.Width <= 0)
                return;
            Control[] controls = {install, secondary, retry, cancelStorageMove,
                applyLocations, discardLocations};
            int count = 0;
            foreach (Control control in controls)
                if (control.Visible) count++;
            if (count == 0) return;
            int available = experienceFooter.ClientSize.Width -
                experienceFooter.Padding.Left -
                experienceFooter.Padding.Right - count * 12 - 8;
            if (available <= 0) return;
            int width = Math.Max(110, Math.Min(205, available / count));
            foreach (Control control in controls)
            {
                if (control.Visible) control.Width = width;
            }
        }

        private void BuildOverview()
        {
            var content = ExperienceStack();
            experiencePages[0].Controls.Add(content);
            Stack(content, ExperienceLabel(T("Состояние установки",
                "Installation status"), 14, Dark, true), 44);
            var card = ExperienceCard();
            Stack(content, card, 202);
            var inside = new TableLayoutPanel {
                Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 5
            };
            inside.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            inside.RowStyles.Add(new RowStyle(SizeType.Absolute, 42F));
            inside.RowStyles.Add(new RowStyle(SizeType.Absolute, 27F));
            inside.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            inside.RowStyles.Add(new RowStyle(SizeType.Absolute, 10F));
            inside.RowStyles.Add(new RowStyle(SizeType.Absolute, 0F));
            card.Controls.Add(inside);
            status.Name = "iwxaSetupStatus";
            status.Text = T("Проверяем содержимое…", "Checking contents…");
            status.Font = new Font("Segoe UI", 14F, FontStyle.Bold);
            status.ForeColor = Dark;
            status.Dock = DockStyle.Fill;
            status.AutoEllipsis = true;
            inside.Controls.Add(status, 0, 0);
            version.Name = "iwxaSetupVersion";
            version.ForeColor = Color.FromArgb(62, 91, 133);
            version.Dock = DockStyle.Fill;
            inside.Controls.Add(version, 0, 1);
            packageDetails.Name = "iwxaSetupDetails";
            packageDetails.Multiline = true;
            packageDetails.ReadOnly = true;
            packageDetails.BorderStyle = BorderStyle.None;
            packageDetails.ScrollBars = ScrollBars.Vertical;
            packageDetails.BackColor = Color.White;
            packageDetails.ForeColor = Secondary;
            packageDetails.WordWrap = true;
            packageDetails.Dock = DockStyle.Fill;
            packageDetails.TabStop = false;
            inside.Controls.Add(packageDetails, 0, 2);
            busyProgress.Name = "iwxaSetupActivity";
            busyProgress.Dock = DockStyle.Fill;
            busyProgress.Style = ProgressBarStyle.Marquee;
            busyProgress.Visible = false;
            inside.Controls.Add(busyProgress, 0, 3);
            Stack(content, ExperienceLabel(T("Выбранные расположения",
                "Current locations"), 14, Dark, true), 44);
            var locationCard = ExperienceCard();
            Stack(content, locationCard, 204);
            var locationLayout = new TableLayoutPanel {
                Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 2
            };
            locationLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            locationLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44F));
            locationLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
            locationLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
            locationCard.Controls.Add(locationLayout);
            locationSummary.Name = "iwxaSetupLocationSummary";
            locationSummary.Dock = DockStyle.Fill;
            locationSummary.ReadOnly = true;
            locationSummary.Multiline = true;
            locationSummary.WordWrap = false;
            locationSummary.ScrollBars = ScrollBars.Both;
            locationSummary.BorderStyle = BorderStyle.None;
            locationSummary.Font = new Font("Consolas", 9F);
            locationSummary.ForeColor = Secondary;
            locationLayout.Controls.Add(locationSummary, 0, 0);
            locationLayout.SetColumnSpan(locationSummary, 2);
            configureInstallation.Name = "iwxaSetupPreferences";
            configureInstallation.Text = T("Изменить папки и запуск",
                "Change folders and startup");
            configureInstallation.Dock = DockStyle.Fill;
            configureInstallation.Margin = new Padding(0, 0, 6, 0);
            configureInstallation.Visible = false;
            StyleSecondaryButton(configureInstallation);
            configureInstallation.Click += (sender, args) =>
                ShowExperiencePage(1);
            locationLayout.Controls.Add(configureInstallation, 0, 1);
            overviewManage.Name = "iwxaSetupOverviewMaintenance";
            overviewManage.Text = T("Обслуживание и удаление",
                "Maintenance and uninstall");
            overviewManage.Dock = DockStyle.Fill;
            overviewManage.Margin = new Padding(6, 0, 0, 0);
            StyleSecondaryButton(overviewManage);
            overviewManage.Click += (sender, args) => ShowExperiencePage(2);
            locationLayout.Controls.Add(overviewManage, 1, 1);
            Stack(content, ExperienceLabel(
                T("Личные данные, модели и сторонние программы сохраняются при удалении самой программы.",
                  "Personal data, models and external software remain when the application is uninstalled."),
                9, Secondary, false), 60);
        }

        private TextBox AddExperiencePath(TableLayoutPanel layout,
            string label, int index, string help)
        {
            Stack(layout, ExperienceLabel(label, 10, Dark, true), 30);
            var row = new TableLayoutPanel {
                Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 1
            };
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130F));
            row.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            var input = new TextBox {
                Name = new [] {
                    "iwxaSetupInlineInstallRoot", "iwxaSetupInlineDataRoot",
                    "iwxaSetupInlineSoftwareRoot", "iwxaSetupInlineModelsRoot",
                    "iwxaSetupInlineCacheRoot"
                }[index],
                Dock = DockStyle.Fill, AccessibleName = label,
                Font = new Font("Segoe UI", 10F),
                Margin = new Padding(0, 3, 8, 4)
            };
            input.TextChanged += (sender, args) => MarkLocationsChanged();
            row.Controls.Add(input, 0, 0);
            var browse = ExperienceButton("iwxaSetupBrowse" + index,
                T("Выбрать…", "Browse…"), false);
            browse.Dock = DockStyle.Fill;
            browse.Margin = new Padding(0, 0, 0, 3);
            browse.Click += (sender, args) =>
            {
                using (var pick = new FolderBrowserDialog { Description = label })
                {
                    string initial = input.Text;
                    try
                    {
                        while (!String.IsNullOrWhiteSpace(initial) &&
                            !Directory.Exists(initial))
                            initial = Path.GetDirectoryName(initial);
                    }
                    catch (ArgumentException) { initial = ""; }
                    catch (NotSupportedException) { initial = ""; }
                    catch (PathTooLongException) { initial = ""; }
                    if (Directory.Exists(initial)) pick.SelectedPath = initial;
                    if (pick.ShowDialog(this) == DialogResult.OK)
                        input.Text = pick.SelectedPath;
                }
            };
            row.Controls.Add(browse, 1, 0);
            if (index == 0) programBrowse = browse;
            Stack(layout, row, 47);
            Stack(layout, ExperienceLabel(help, 9, Secondary, false), 33);
            locationInputs[index] = input;
            return input;
        }

        private void BuildInlineSettings()
        {
            var stack = ExperienceStack();
            experiencePages[1].Controls.Add(stack);
            Stack(stack, ExperienceLabel(T("Расположение программы и данных",
                "Application and data locations"), 15, Dark, true), 48);
            Stack(stack, ExperienceLabel(T(
                "Выберите папку программы отдельно от личных данных. Для уже установленной программы папка приложения не меняется.",
                "Choose the application folder separately from personal data. An installed application retains its location."),
                9, Secondary, false), 50);
            AddExperiencePath(stack, T("Программа", "Application"), 0,
                T("Папка самой программы. При обновлении остаётся прежней.",
                  "The application folder is preserved during updates."));
            Stack(stack, ExperienceLabel(T("Общее расположение хранилищ",
                "Shared storage location"), 10, Dark, true), 30);
            var common = new TableLayoutPanel {
                Dock = DockStyle.Fill, ColumnCount = 3, RowCount = 1
            };
            common.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100F));
            common.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130F));
            common.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 145F));
            common.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            commonStorageInput.Name = "iwxaSetupCommonRoot";
            commonStorageInput.Dock = DockStyle.Fill;
            commonStorageInput.Margin = new Padding(0, 3, 8, 4);
            commonStorageInput.AccessibleName = T(
                "Общая папка хранения", "Shared storage folder");
            commonStorageInput.TextChanged += (sender, args) =>
            {
                if (updatingLocationInputs) return;
                commonEditedByUser = true;
                MarkLocationsChanged();
            };
            commonStorageInput.Leave += (sender, args) =>
            {
                if (!commonEditedByUser ||
                    String.IsNullOrWhiteSpace(commonStorageInput.Text)) return;
                try { ApplyCommonStorage(commonStorageInput.Text); }
                catch (Exception ex) { ShowLocationError(ex); }
            };
            common.Controls.Add(commonStorageInput, 0, 0);
            var chooseCommon = ExperienceButton("iwxaSetupBrowseCommon",
                T("Выбрать…", "Browse…"), false);
            chooseCommon.Dock = DockStyle.Fill;
            chooseCommon.Margin = new Padding(0, 0, 6, 3);
            chooseCommon.Click += (sender, args) =>
            {
                using (var picker = new FolderBrowserDialog {
                    Description = T("Выберите общую папку IWXA",
                        "Choose a shared IWXA storage location")
                })
                {
                    if (Directory.Exists(commonStorageInput.Text))
                        picker.SelectedPath = commonStorageInput.Text;
                    if (picker.ShowDialog(this) == DialogResult.OK)
                        ApplyCommonStorage(picker.SelectedPath);
                }
            };
            common.Controls.Add(chooseCommon, 1, 0);
            var distribute = ExperienceButton("iwxaSetupApplyCommon",
                T("Для всех папок", "Use for all"), false);
            distribute.Dock = DockStyle.Fill;
            distribute.Margin = new Padding(0, 0, 0, 3);
            distribute.Click += (sender, args) =>
            {
                try { ApplyCommonStorage(commonStorageInput.Text); }
                catch (Exception ex) { ShowLocationError(ex); }
            };
            common.Controls.Add(distribute, 2, 0);
            Stack(stack, common, 47);
            Stack(stack, ExperienceLabel(T(
                "Из общей папки создаются Data, Software, Models и Cache. Каждую папку можно затем изменить отдельно.",
                "The common location provides Data, Software, Models and Cache. You can change individual folders afterwards."),
                9, Secondary, false), 43);
            AddExperiencePath(stack, T("Личные данные", "Personal data"), 1,
                T("Настройки, рабочие файлы и результаты.", "Settings, work and results."));
            AddExperiencePath(stack, T("Сторонние программы", "Third-party software"), 2,
                T("Расположение для подключаемого программного обеспечения.",
                  "Location for optional applications."));
            AddExperiencePath(stack, T("Локальные модели", "Local models"), 3,
                T("Расположение скачиваемых позднее моделей.",
                  "Location for models added later."));
            AddExperiencePath(stack, T("Кэш", "Cache"), 4,
                T("Временные файлы, отдельно от личных данных.",
                  "Temporary files, separate from personal data."));
            launchAtLogin.Name = "iwxaSetupInlineAutostart";
            launchAtLogin.Text = T("Запускать программу при входе в Windows",
                "Start the application when signing in to Windows");
            launchAtLogin.ForeColor = Dark;
            launchAtLogin.CheckedChanged += (sender, args) =>
                MarkLocationsChanged();
            Stack(stack, launchAtLogin, 42);
            launchAfterSetup.Text = T("Открыть программу после установки или обновления",
                "Open the application after installation or update");
            launchAfterSetup.ForeColor = Dark;
            Stack(stack, launchAfterSetup, 42);
            draftNotice.Name = "iwxaSetupUnsavedNote";
            draftNotice.ForeColor = Color.FromArgb(151, 91, 28);
            Stack(stack, draftNotice, 44);
            Stack(stack, ExperienceLabel(
                T("При переносе IWXA сначала копирует и проверяет данные. Старые папки остаются без изменений.",
                  "When moving storage, IWXA copies and verifies files first. Original folders are preserved."),
                9, Secondary, false), 55);
        }

        private void BuildMaintenance()
        {
            var stack = ExperienceStack();
            experiencePages[2].Controls.Add(stack);
            Stack(stack, ExperienceLabel(T("Управление установленной программой",
                "Manage the installed application"), 15, Dark, true), 50);
            Stack(stack, ExperienceLabel(T(
                "Действия зависят от проверенного состояния программы. Ваши личные данные при обновлении и восстановлении сохраняются.",
                "Available actions depend on the verified installed state. Updates and repair keep your personal data."),
                9, Secondary, false), 58);
            serviceExplanation.Name = "iwxaSetupMaintenanceExplanation";
            serviceExplanation.ForeColor = Secondary;
            Stack(stack, serviceExplanation, 100);
            servicePrimary.Name = "iwxaSetupMaintenancePrimary";
            servicePrimary.Text = T("Продолжить обслуживание", "Continue maintenance");
            servicePrimary.BackColor = Accent;
            servicePrimary.ForeColor = Color.White;
            servicePrimary.FlatStyle = FlatStyle.Flat;
            servicePrimary.FlatAppearance.BorderSize = 0;
            servicePrimary.Click += async (sender, args) =>
                await ExecuteAsync(primaryAction);
            Stack(stack, servicePrimary, 51);
            serviceSecondary.Name = "iwxaSetupMaintenanceAlternate";
            StyleSecondaryButton(serviceSecondary);
            serviceSecondary.Click += async (sender, args) =>
                await ExecuteAsync(secondaryAction);
            Stack(stack, serviceSecondary, 51);
            serviceOwnedSetup.Name = "iwxaSetupOpenInstalledMaintenance";
            serviceOwnedSetup.Text = T("Восстановить через установленный пакет",
                "Repair using installed package");
            StyleSecondaryButton(serviceOwnedSetup);
            serviceOwnedSetup.Click += (sender, args) =>
                OpenInstalledMaintenance();
            Stack(stack, serviceOwnedSetup, 51);
            openApplication.Name = "iwxaSetupRelatedAction";
            openApplication.Text = T("Открыть установленную программу",
                "Open installed application");
            openApplication.Font = new Font("Segoe UI", 11F);
            openApplication.LinkColor = Accent;
            openApplication.LinkClicked += (sender, args) => OpenRelatedAction();
            Stack(stack, openApplication, 45);
            openRemoval.Name = "iwxaSetupOpenUninstall";
            openRemoval.Text = T("Перейти к удалению программы",
                "Open uninstall");
            StyleSecondaryButton(openRemoval);
            openRemoval.Click += (sender, args) => ShowExperiencePage(4);
            Stack(stack, openRemoval, 56);
        }

        private void BuildRemoval()
        {
            var stack = ExperienceStack();
            experiencePages[4].Controls.Add(stack);
            Stack(stack, ExperienceLabel(T("Удаление программы",
                "Uninstall application"), 16, Dark, true), 58);
            Stack(stack, ExperienceLabel(T(
                "Удаляется только проверенная программа. Действующие файлы пользователя, стороннее ПО, локальные модели и кэш сохраняются.",
                "Only the verified application is removed. Your data, other software, local models and cache are kept."),
                10, Secondary, false), 90);
            removalExplanation.Name = "iwxaSetupUninstallExplanation";
            removalExplanation.ForeColor = Dark;
            removalExplanation.Font = new Font("Segoe UI", 11F);
            Stack(stack, removalExplanation, 102);
            Stack(stack, ExperienceLabel(T(
                "Удаление не затрагивает другие программы IWXA. При необходимости после него можно самостоятельно проверить сохранённые папки.",
                "Uninstalling does not modify other IWXA applications. You can review the preserved folders afterwards."),
                9, Secondary, false), 80);
            removeApplication.Name = "iwxaSetupRemoveApplication";
            removeApplication.Text = T("Удалить установленную программу…",
                "Uninstall the installed application…");
            removeApplication.AccessibleDescription = T(
                "Открыть подтверждение удаления с сохранением личных данных",
                "Review uninstall while preserving personal data");
            removeApplication.Font = new Font("Segoe UI", 13F, FontStyle.Bold);
            removeApplication.LinkColor = Color.FromArgb(166, 53, 62);
            removeApplication.LinkClicked += async (sender, args) =>
                await BeginUninstallAsync();
            Stack(stack, removeApplication, 61);
        }

        private void BuildComponents()
        {
            var stack = ExperienceStack();
            experiencePages[3].Controls.Add(stack);
            Stack(stack, ExperienceLabel(T("Компоненты для работы",
                "Application components"), 15, Dark, true), 54);
            Stack(stack, ExperienceLabel("Microsoft WebView2", 13, Dark, true), 43);
            componentStatus.Name = "iwxaSetupWebView2Status";
            componentStatus.ForeColor = Dark;
            Stack(stack, componentStatus, 45);
            Stack(stack, ExperienceLabel(T(
                "Если компонент требуется этой программе и отсутствует, используйте официальный выпуск Microsoft. Данные и установленная программа не изменяются.",
                "If the application needs this component and it is missing, use Microsoft's official installer. Application files and data are not modified."),
                9, Secondary, false), 83);
            webOnline.Name = "iwxaSetupInstallWebView2Online";
            webOnline.Text = T("Установить WebView2 через интернет",
                "Install WebView2 online");
            StyleSecondaryButton(webOnline);
            webOnline.Click += async (sender, args) =>
                await ExecuteAsync(SetupOperation.InstallWebView2);
            Stack(stack, webOnline, 51);
            webOffline.Name = "iwxaSetupInstallWebView2Offline";
            webOffline.Text = T("Установить WebView2 из файла Microsoft…",
                "Install WebView2 from Microsoft file…");
            StyleSecondaryButton(webOffline);
            webOffline.Click += async (sender, args) =>
                await ExecuteAsync(SetupOperation.InstallWebView2Offline);
            Stack(stack, webOffline, 51);
            webRefresh.Name = "iwxaSetupCheckWebView2";
            webRefresh.Text = T("Проверить состояние компонента",
                "Check component status");
            StyleSecondaryButton(webRefresh);
            webRefresh.Click += (sender, args) => RefreshComponents();
            Stack(stack, webRefresh, 51);
            Stack(stack, ExperienceLabel(T("Другие программы и модели",
                "Other applications and models"), 13, Dark, true), 52);
            Stack(stack, ExperienceLabel(T(
                "Этот установщик не скачивает стороннее ПО и модели. Для них можно заранее выбрать папки в разделе «Папки и запуск». Подключение выполняется в соответствующей программе IWXA.",
                "Setup does not download third-party applications or models. You can choose their folders under Folders and startup. Connect them from the relevant IWXA application."),
                9, Secondary, false), 104);
        }

        private void FocusOperationProgress()
        {
            currentExperiencePage = 0;
            locationDraftChanged = false;
            for (int i = 0; i < experiencePages.Length; i++)
            {
                experiencePages[i].Visible = i == 0;
                experienceNavigation[i].BackColor = i == 0 ?
                    Color.FromArgb(231, 241, 255) : Color.White;
                experienceNavigation[i].ForeColor = i == 0 ? Accent : Dark;
            }
            experiencePages[0].BringToFront();
        }

        private void ShowExperiencePage(int page)
        {
            if (page < 0 || page >= experiencePages.Length ||
                performingOperation || verifyingState) return;
            if (currentExperiencePage == 1 && page != 1 &&
                locationDraftChanged)
            {
                DialogResult leave = MessageBox.Show(this,
                    T("Есть несохранённые изменения. Сбросить их?",
                        "You have unsaved settings. Discard them?"),
                    T("Папки и запуск", "Folders and startup"),
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2);
                if (leave != DialogResult.Yes) return;
                RefreshExperienceLocations(true);
            }
            currentExperiencePage = page;
            for (int i = 0; i < experiencePages.Length; i++)
            {
                experiencePages[i].Visible = i == page;
                experienceNavigation[i].BackColor = i == page ?
                    Color.FromArgb(231, 241, 255) : Color.White;
                experienceNavigation[i].ForeColor = i == page ?
                    Accent : Dark;
            }
            experiencePages[page].BringToFront();
            AcceptButton = page == 0 ? install :
                page == 1 ? applyLocations : null;
            RefreshExperienceButtons();
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
                webOnline.Enabled = required && missing &&
                    !performingOperation && !verifyingState;
                webOffline.Enabled = webOnline.Enabled;
            }
            catch (Exception ex)
            {
                componentStatus.Text = T("Не удалось проверить WebView2.",
                    "Could not check WebView2.");
                webOnline.Enabled = webOffline.Enabled = false;
                SetTechnicalReport(inspectedBundle, inspectedStatus, ex.Message);
            }
        }

        private void RefreshExperience(BundleInfo info, UpgradeAssessment plan)
        {
            if (info == null || plan == null) return;
            bool firstInstallation = plan.Status == "NO_OWNED_INSTALLATION";
            journeyStage.Text = firstInstallation ?
                T("ПЕРВАЯ УСТАНОВКА", "FIRST INSTALLATION") :
                T("УПРАВЛЕНИЕ УСТАНОВЛЕННОЙ ПРОГРАММОЙ",
                    "MANAGE INSTALLED APPLICATION");
            description.Text = firstInstallation ?
                T("Выберите расположения, проверьте компоненты и установите программу.",
                    "Choose locations, review components and install.") :
                T("Настройки, обновление, восстановление и удаление — в одном окне.",
                    "Settings, updates, recovery and uninstall in one place.");
            SetupLocations paths = null;
            try
            {
                paths = plan.Status == "NO_OWNED_INSTALLATION" ?
                    selectedLocations : SetupInstallation.InstalledLocations(info);
                if (paths != null)
                {
                    locationSummary.Text =
                        T("Программа: ", "Application: ") + paths.ProgramRoot +
                        Environment.NewLine +
                        T("Личные данные: ", "Personal data: ") + paths.DataRoot +
                        Environment.NewLine +
                        T("Стороннее ПО: ", "External software: ") +
                            paths.SoftwareRoot + Environment.NewLine +
                        T("Модели: ", "Models: ") + paths.ModelsRoot +
                            Environment.NewLine +
                        T("Кэш: ", "Cache: ") + paths.CacheRoot +
                            Environment.NewLine +
                        T("Автозапуск: ", "Windows startup: ") +
                            (paths.StartWithWindows ? T("включён", "on") :
                                T("выключен", "off"));
                }
            }
            catch (Exception ex)
            {
                SetTechnicalReport(info, plan.Status, ex.Message);
            }
            RefreshExperienceLocations(false);
            RefreshComponents();
            serviceExplanation.Text = plan.Status == "SAME_VERSION_DIFFERENT_PACKAGE" ?
                T("Установлена другая сборка с тем же номером версии. Применять этот пакет поверх неё нельзя. Вы можете открыть её собственный установщик для восстановления, изменить настройки или удалить программу.",
                  "Another build of the same version is installed. This package cannot replace it. You can repair using its own package, change settings or uninstall.") :
                plan.Status == "DOWNGRADE_BLOCKED" ?
                T("Уже установлена более новая версия. Этот пакет не заменит её. Используйте обслуживание установленной версии или выберите новое обновление.",
                  "A newer release is installed. This package cannot replace it. Use the installed release's maintenance or a newer update.") :
                plan.Status == "NO_OWNED_INSTALLATION" ?
                T("Программа ещё не установлена. Выберите расположения и параметры запуска, затем нажмите «Установить» на обзоре.",
                  "The application is not installed. Choose folders and startup settings, then select Install on Overview.") :
                plan.Status == "APPLICATION_RUNNING" ?
                T("Программа сейчас открыта. Закройте её, затем нажмите «Проверить снова», чтобы продолжить обновление, восстановление или удаление.",
                  "The application is running. Close it, then choose Check again to continue updating, repairing or uninstalling.") :
                plan.Status == "UPGRADE_PENDING_CONFIRMATION" ||
                plan.Status == "REPAIR_PENDING_CONFIRMATION_NO_ROLLBACK" ?
                T("Новая установка ожидает подтверждения. Откройте программу и проверьте свои данные. После проверки завершите обновление или верните прежнюю версию, если она доступна.",
                  "The new installation awaits confirmation. Open the application and check your data. Then complete the update or restore the prior release if available.") :
                plan.Status == "UPGRADE_RECOVERY_REQUIRED" ?
                T("Предыдущая операция прервалась. Сначала восстановите предыдущую версию. Личные данные сохраняются.",
                  "An earlier operation was interrupted. Restore the previous release before continuing. Personal data is preserved.") :
                plan.Status == "WEBVIEW2_MISSING" ?
                T("Для работы нужен Microsoft WebView2. Перейдите в «Компоненты» и установите его через интернет или из официального файла.",
                  "Microsoft WebView2 is required. Open Components to install it online or from Microsoft's official file.") :
                T("На этом экране показаны действия, доступные для установленной версии. Личные данные при обслуживании сохраняются.",
                  "This page shows actions available for the installed release. Maintenance preserves your personal data.");
            RefreshExperienceButtons();
        }

        private void RefreshExperienceButtons()
        {
            if (experiencePages[0] == null) return;
            bool ready = !performingOperation && !verifyingState;
            bool settings = currentExperiencePage == 1;
            bool maintenance = currentExperiencePage == 2;
            install.Visible = currentExperiencePage == 0 &&
                primaryAction != SetupOperation.None;
            install.Enabled = ready && primaryAction != SetupOperation.None &&
                !locationDraftChanged;
            secondary.Visible = currentExperiencePage == 0 &&
                secondaryAction != SetupOperation.None;
            secondary.Enabled = ready && secondaryAction != SetupOperation.None;
            retry.Visible = currentExperiencePage == 0 || maintenance;
            retry.Enabled = ready;
            applyLocations.Visible = settings;
            applyLocations.Enabled = ready && locationDraftChanged &&
                inspectedBundle != null;
            discardLocations.Visible = settings;
            discardLocations.Enabled = ready && locationDraftChanged;
            configureInstallation.Enabled = ready && inspectedBundle != null;
            servicePrimary.Text = install.Text;
            servicePrimary.Visible = primaryAction != SetupOperation.None;
            servicePrimary.Enabled = ready && primaryAction != SetupOperation.None;
            serviceSecondary.Text = secondary.Text;
            serviceSecondary.Visible = secondaryAction != SetupOperation.None;
            serviceSecondary.Enabled = ready && secondaryAction != SetupOperation.None;
            serviceOwnedSetup.Visible = inspectedStatus == "SAME_VERSION_DIFFERENT_PACKAGE" ||
                inspectedStatus == "DOWNGRADE_BLOCKED" ||
                inspectedStatus == "VERSION_UNSUPPORTED";
            serviceOwnedSetup.Enabled = ready && serviceOwnedSetup.Visible;
            overviewManage.Visible = inspectedBundle != null &&
                inspectedStatus != "NO_OWNED_INSTALLATION";
            overviewManage.Enabled = ready && overviewManage.Visible;
            openRemoval.Enabled = ready && removeApplication.Visible;
            removalExplanation.Text = removeApplication.Visible ?
                T("Программа установлена и может быть удалена. Перед удалением появится подтверждение с перечнем сохраняемых папок.",
                    "An installed application can be removed. You will review the preserved locations before uninstalling.") :
                T("Проверенной установки для удаления пока нет. Сначала выполните проверку в разделе «Обзор».",
                    "No verified application is available to uninstall. Check the installation under Overview.");
            openApplication.Enabled = ready && openApplication.Visible;
            removeApplication.Enabled = ready && removeApplication.Visible;
            for (int i = 0; i < experienceNavigation.Length; i++)
                experienceNavigation[i].Enabled = ready;
            ResizeExperienceFooter();
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

        private DialogResult ConfirmExperienceUninstall(BundleInfo info)
        {
            using (var dialog = new Form {
                Text = T("Удаление программы", "Uninstall application"),
                StartPosition = FormStartPosition.CenterParent,
                ClientSize = new Size(650, 410),
                MinimumSize = new Size(500, 330),
                AutoScaleMode = AutoScaleMode.Dpi,
                Font = new Font("Segoe UI", 10F),
                BackColor = Color.White
            })
            {
                var stack = ExperienceStack();
                var scroll = new Panel {
                    Dock = DockStyle.Fill, AutoScroll = true,
                    BackColor = Color.White
                };
                dialog.Controls.Add(scroll);
                scroll.Controls.Add(stack);
                Stack(stack, ExperienceLabel(T("Удалить ", "Uninstall ") +
                    info.Name + "?", 17, Dark, true), 58);
                Stack(stack, ExperienceLabel(T(
                    "Будут удалены только файлы программы, принадлежащие IWXA. После удаления она перестанет запускаться с этого компьютера.",
                    "Only IWXA-owned application files are removed. The application will no longer launch from this computer."),
                    10, Secondary, false), 77);
                SetupLocations locations = SetupInstallation.InstalledLocations(info);
                Stack(stack, ExperienceLabel(T(
                    "Останутся личные данные, сторонние программы, модели и кэш.",
                    "Personal data, external applications, models and cache will be kept."),
                    11, Dark, true), 62);
                var paths = new TextBox {
                    Multiline = true, ReadOnly = true, BorderStyle = BorderStyle.None,
                    ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill,
                    BackColor = Color.White, ForeColor = Secondary,
                    Text = T("Личные данные: ", "Personal data: ") +
                        locations.DataRoot + Environment.NewLine +
                        T("Программы: ", "Software: ") +
                        locations.SoftwareRoot + Environment.NewLine +
                        T("Модели: ", "Models: ") +
                        locations.ModelsRoot + Environment.NewLine +
                        T("Кэш: ", "Cache: ") + locations.CacheRoot
                };
                Stack(stack, paths, 101);
                var actions = new FlowLayoutPanel {
                    Dock = DockStyle.Fill,
                    FlowDirection = FlowDirection.RightToLeft
                };
                var remove = ExperienceButton("iwxaSetupConfirmRemoval",
                    T("Удалить только программу", "Uninstall application"), false);
                remove.Size = new Size(240, 42);
                remove.ForeColor = Color.FromArgb(158, 45, 57);
                remove.DialogResult = DialogResult.Yes;
                var cancel = ExperienceButton("iwxaSetupKeepInstallation",
                    T("Оставить программу", "Keep application"), false);
                cancel.DialogResult = DialogResult.Cancel;
                cancel.Size = new Size(190, 42);
                actions.Controls.Add(cancel);
                actions.Controls.Add(remove);
                Stack(stack, actions, 56);
                dialog.CancelButton = cancel;
                dialog.Shown += (sender, args) => FitDialogToWorkingArea(dialog);
                return dialog.ShowDialog(this);
            }
        }
    }
}

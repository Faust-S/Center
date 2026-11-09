using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Windows.Forms;
using System.Threading.Tasks;

namespace IwxaSetup
{
    // The single-window desktop workflow. Setup Core's existing installation,
    // repair, storage and ownership mechanisms remain the only executors.
    internal sealed partial class SetupForm
    {
        private readonly Label unifiedExplanation = new Label();
        private readonly Label unifiedLocationHint = new Label();
        private readonly Label unifiedSectionTitle = new Label();
        private readonly Label unifiedManageTitle = new Label();
        private readonly Label unifiedReadyNotes = new Label();
        private readonly Panel unifiedActionBox = new Panel();
        private readonly TableLayoutPanel priorDataChoices = new TableLayoutPanel();
        private readonly CheckBox copyPriorData = new CheckBox();
        private readonly Label copyPriorDataDetails = new Label();
        private readonly TableLayoutPanel unifiedActionGrid =
            new TableLayoutPanel();
        private readonly PictureBox unifiedBrand = new PictureBox();
        private readonly Panel unifiedPathPanel = new Panel();
        private readonly TableLayoutPanel unifiedMain = new TableLayoutPanel();
        private readonly TableLayoutPanel unifiedLeft = new TableLayoutPanel();
        private readonly TableLayoutPanel unifiedRight = new TableLayoutPanel();
        private readonly Button compactSettings = new Button();
        private bool unifiedCompact;
        private bool resizingUnified;

        private static readonly Color Surface = Color.FromArgb(239, 244, 250);
        private static readonly Color Navy = Color.FromArgb(20, 36, 67);
        private static readonly Color Line = Color.FromArgb(219, 229, 241);
        private static readonly Color BrandRed = Color.FromArgb(239, 83, 80);

        private static Label UiLabel(string text, float size = 9F,
            bool bold = false, Color? color = null)
        {
            return new Label {
                Text = text, Dock = DockStyle.Fill,
                TextAlign = ContentAlignment.MiddleLeft,
                ForeColor = color ?? Navy,
                Font = new Font("Segoe UI", size, bold ?
                    FontStyle.Bold : FontStyle.Regular),
                AutoEllipsis = false,
                Margin = new Padding(0)
            };
        }

        private static TableLayoutPanel UiTable(int columns, params float[] widths)
        {
            var table = new TableLayoutPanel {
                Dock = DockStyle.Fill, ColumnCount = columns,
                RowCount = 1, Padding = Padding.Empty,
                Margin = Padding.Empty,
                BackColor = Color.Transparent,
                CellBorderStyle = TableLayoutPanelCellBorderStyle.None
            };
            foreach (float width in widths)
                table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, width));
            return table;
        }

        private static Panel UiCard()
        {
            return new Panel {
                Dock = DockStyle.Fill, Margin = new Padding(0),
                Padding = new Padding(16, 12, 16, 10),
                BackColor = Color.White,
                BorderStyle = BorderStyle.None,
                AutoScroll = false
            };
        }

        private static void LightOutline(Panel panel)
        {
            panel.BorderStyle = BorderStyle.None;
            panel.Paint += (sender, args) =>
            {
                using (var pen = new Pen(Line, 1F))
                    args.Graphics.DrawRectangle(pen, 0, 0,
                        Math.Max(0, panel.ClientSize.Width - 1),
                        Math.Max(0, panel.ClientSize.Height - 1));
            };
            panel.Resize += (sender, args) => panel.Invalidate();
        }

        private static void UiRow(TableLayoutPanel table, int index,
            float percent, Control content)
        {
            while (table.RowStyles.Count <= index)
                table.RowStyles.Add(new RowStyle(SizeType.Percent, 0));
            table.RowStyles[index].SizeType = SizeType.Percent;
            table.RowStyles[index].Height = percent;
            table.Controls.Add(content, 0, index);
        }

        private static Bitmap BrandMark(Color background)
        {
            // Exactly the Personal Agent's 64x64 IWXA symbol geometry:
            // same rounded field, left bar and crossed strokes. The color
            // differs by product; Admin Center uses red, not Agent green.
            var bitmap = new Bitmap(64, 64, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(bitmap))
            using (var shape = new GraphicsPath())
            using (var baseBrush = new SolidBrush(background))
            using (var glyph = new SolidBrush(Color.FromArgb(5, 7, 13)))
            using (var stroke = new Pen(Color.FromArgb(5, 7, 13), 7F))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                shape.AddArc(0, 0, 20, 20, 180, 90);
                shape.AddArc(44, 0, 20, 20, 270, 90);
                shape.AddArc(44, 44, 20, 20, 0, 90);
                shape.AddArc(0, 44, 20, 20, 90, 90);
                shape.CloseFigure();
                g.FillPath(baseBrush, shape);
                g.FillRectangle(glyph, 13F, 13F, 7F, 38F);
                stroke.StartCap = LineCap.Flat;
                stroke.EndCap = LineCap.Flat;
                g.DrawLine(stroke, 29F, 14F, 51F, 50F);
                g.DrawLine(stroke, 51F, 14F, 29F, 50F);
            }
            return bitmap;
        }

        private static Color ProductBrand(BundleInfo info)
        {
            if (info == null) return BrandRed;
            string id = (info.Id ?? "").ToLowerInvariant();
            if (id.Contains("agent") || id.Contains("personal"))
                return Color.FromArgb(182, 242, 75);
            if (id.Contains("atlas")) return Color.FromArgb(65, 135, 245);
            if (id.Contains("publisher")) return Color.White;
            return BrandRed;
        }

        private void BuildUnifiedLayout()
        {
            // No outer scrollbar and no nested scrollbar. Each control has
            // a defined share of the available work area.
            BackColor = Surface;
            MinimumSize = new Size(830, 520);
            ClientSize = new Size(1090, 672);
            MaximizeBox = true;
            Text = T("IWXA - установка и обслуживание",
                "IWXA - installation and maintenance");

            var shell = UiTable(1, 100);
            shell.RowCount = 3;
            shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 120));
            shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 70));
            shell.BackColor = Surface;
            Controls.Add(shell);

            var header = UiTable(3, 8, 72, 20);
            header.Padding = new Padding(24, 11, 24, 6);
            header.BackColor = Color.White;
            unifiedBrand.Dock = DockStyle.Left;
            unifiedBrand.Size = new Size(54, 54);
            unifiedBrand.SizeMode = PictureBoxSizeMode.Zoom;
            unifiedBrand.Image = BrandMark(BrandRed);
            unifiedBrand.AccessibleName = T(
                "Знак IWXA Admin Center", "IWXA Admin Center brand mark");
            header.Controls.Add(unifiedBrand, 0, 0);
            var names = UiTable(1, 100);
            names.RowCount = 2;
            names.RowStyles.Add(new RowStyle(SizeType.Percent, 56));
            names.RowStyles.Add(new RowStyle(SizeType.Percent, 44));
            productName.Name = "iwxaSetupProductTitle";
            productName.Text = T("Программа IWXA", "IWXA application");
            productName.Font = new Font("Segoe UI", 18.5F, FontStyle.Bold);
            productName.ForeColor = Navy;
            productName.TextAlign = ContentAlignment.MiddleLeft;
            productName.Dock = DockStyle.Fill;
            productName.AutoEllipsis = false;
            names.Controls.Add(productName, 0, 0);
            description.Text = T("Установка и обслуживание",
                "Installation and maintenance");
            description.Dock = DockStyle.Fill;
            description.Font = new Font("Segoe UI", 9.5F);
            description.ForeColor = Secondary;
            description.TextAlign = ContentAlignment.MiddleLeft;
            names.Controls.Add(description, 0, 1);
            header.Controls.Add(names, 1, 0);
            technicalDetails.Name = "iwxaSetupTechnicalDetails";
            technicalDetails.Text = T("Технические сведения",
                "Technical details");
            technicalDetails.LinkColor = Color.FromArgb(48, 89, 144);
            technicalDetails.TextAlign = ContentAlignment.MiddleRight;
            technicalDetails.Dock = DockStyle.Fill;
            technicalDetails.Visible = false;
            technicalDetails.LinkClicked += (sender, args) => {
                if (String.IsNullOrWhiteSpace(technicalReport)) return;
                using (Form details = CreateTechnicalDetailsDialog())
                    details.ShowDialog(this);
            };
            header.Controls.Add(technicalDetails, 2, 0);
            shell.Controls.Add(header, 0, 0);

            unifiedMain.ColumnCount = 2;
            unifiedMain.RowCount = 1;
            unifiedMain.Dock = DockStyle.Fill;
            unifiedMain.Padding = new Padding(22, 12, 22, 12);
            unifiedMain.Margin = Padding.Empty;
            unifiedMain.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 65));
            unifiedMain.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 35));
            unifiedMain.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            shell.Controls.Add(unifiedMain, 0, 1);

            unifiedPathPanel.Dock = DockStyle.Fill;
            unifiedPathPanel.Padding = Padding.Empty;
            unifiedPathPanel.Margin = new Padding(0, 0, 12, 0);
            unifiedPathPanel.BackColor = Color.White;
            unifiedPathPanel.BorderStyle = BorderStyle.None;
            unifiedPathPanel.AutoScroll = false;
            LightOutline(unifiedPathPanel);
            unifiedMain.Controls.Add(unifiedPathPanel, 0, 0);
            BuildUnifiedSettings();
            var rightCard = UiCard();
            LightOutline(rightCard);
            unifiedMain.Controls.Add(rightCard, 1, 0);
            BuildUnifiedStatus(rightCard);

            var footer = UiTable(2, 33, 67);
            footer.BackColor = Color.White;
            footer.Padding = new Padding(22, 13, 22, 13);
            footer.Margin = Padding.Empty;
            footer.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            shell.Controls.Add(footer, 0, 2);
            // Keep the complete message on one line even on laptop screens.
            // The longer explanation is already visible in the status area.
            var footerHelp = UiLabel(T(
                "Личные данные сохраняются", "Personal data is preserved"),
                9F, false, Secondary);
            footerHelp.AutoEllipsis = false;
            footer.Controls.Add(footerHelp, 0, 0);

            var actions = new FlowLayoutPanel {
                Dock = DockStyle.Fill,
                FlowDirection = FlowDirection.RightToLeft,
                WrapContents = false,
                Margin = Padding.Empty, Padding = Padding.Empty,
                BackColor = Color.White
            };
            footer.Controls.Add(actions, 1, 0);
            install.Name = "iwxaSetupPrimaryAction";
            SetupButton(install, true, 163);
            install.Click += async (sender, args) => await UnifiedPrimaryAsync();
            actions.Controls.Add(install);
            applyLocations.Name = "iwxaSetupApplyLocations";
            applyLocations.Text = T("Применить", "Apply");
            SetupButton(applyLocations, true, 168);
            applyLocations.Click += async (sender, args) =>
                await SaveExperienceLocationsAsync();
            actions.Controls.Add(applyLocations);
            secondary.Name = "iwxaSetupAlternateAction";
            SetupButton(secondary, false, 160);
            secondary.Click += async (sender, args) =>
                await ExecuteAsync(secondaryAction);
            actions.Controls.Add(secondary);
            discardLocations.Name = "iwxaSetupDiscardLocations";
            discardLocations.Text = T("Отменить правки", "Discard changes");
            SetupButton(discardLocations, false, 157);
            discardLocations.Click += (sender, args) =>
                RefreshExperienceLocations(true);
            actions.Controls.Add(discardLocations);
            retry.Name = "iwxaSetupRecheck";
            retry.Text = T("Проверить", "Check again");
            SetupButton(retry, false, 133);
            retry.Click += async (sender, args) => await VerifyAsync();
            actions.Controls.Add(retry);
            cancelStorageMove.Name = "iwxaSetupCancelStorageMove";
            cancelStorageMove.Text = T("Отменить перенос", "Cancel transfer");
            SetupButton(cancelStorageMove, false, 165);
            cancelStorageMove.Visible = false;
            cancelStorageMove.Click += (sender, args) => {
                if (storageCancellation == null ||
                    storageCancellation.IsCancellationRequested) return;
                storageCancellation.Cancel();
                cancelStorageMove.Enabled = false;
                status.Text = T("Останавливаем перенос",
                    "Cancelling storage transfer");
            };
            actions.Controls.Add(cancelStorageMove);

            AcceptButton = install;
            Shown += (sender, args) => AdjustUnifiedForScreen();
            Resize += (sender, args) => AdjustUnifiedForScreen();
            RefreshUnifiedButtons();
        }

        private void SetupButton(Button button, bool primary, int width)
        {
            button.Size = new Size(width, 42);
            button.Margin = new Padding(5, 0, 5, 0);
            button.Cursor = Cursors.Hand;
            button.Font = new Font("Segoe UI", 9.5F,
                primary ? FontStyle.Bold : FontStyle.Regular);
            button.FlatStyle = FlatStyle.Flat;
            button.BackColor = primary ? Accent : Color.FromArgb(248, 251, 255);
            button.ForeColor = primary ? Color.White : Navy;
            button.FlatAppearance.BorderColor = Line;
            button.FlatAppearance.BorderSize = primary ? 0 : 1;
            button.AutoEllipsis = false;
            button.UseVisualStyleBackColor = false;
        }

        private Control UnifiedPathRow(string caption, TextBox input,
            string name, Action select)
        {
            var row = UiTable(3, 25, 65, 10);
            row.Margin = new Padding(0, 2, 0, 2);
            var label = UiLabel(caption, 9.25F, false, Navy);
            row.Controls.Add(label, 0, 0);
            input.Name = name;
            input.Font = new Font("Segoe UI", 9.25F);
            input.Dock = DockStyle.Fill;
            input.Margin = new Padding(2, 5, 6, 5);
            input.BorderStyle = BorderStyle.FixedSingle;
            input.BackColor = Color.FromArgb(249, 251, 255);
            input.AccessibleName = caption;
            input.TextChanged += (sender, args) => MarkLocationsChanged();
            row.Controls.Add(input, 1, 0);
            var browse = new Button {
                Name = name + "Browse",
                Text = "…", AccessibleName = T(
                    "Выбрать папку: ", "Choose folder: ") + caption,
                Dock = DockStyle.Fill, Margin = new Padding(0, 3, 0, 3),
                Font = new Font("Segoe UI", 11, FontStyle.Bold),
                BackColor = Color.FromArgb(246, 249, 254),
                ForeColor = Navy, FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand
            };
            browse.FlatAppearance.BorderColor = Line;
            browse.Click += (sender, args) => select();
            if (input == locationInputs[0]) programBrowse = browse;
            row.Controls.Add(browse, 2, 0);
            var tooltip = new ToolTip();
            tooltip.SetToolTip(input, caption);
            tooltip.SetToolTip(browse, caption);
            return row;
        }

        private void ChooseUnifiedPath(TextBox input, string caption)
        {
            using (var picker = new FolderBrowserDialog {
                Description = caption,
                ShowNewFolderButton = true
            })
            {
                string directory = input.Text;
                try {
                    while (!String.IsNullOrWhiteSpace(directory) &&
                           !Directory.Exists(directory))
                        directory = Path.GetDirectoryName(directory);
                }
                catch (ArgumentException) { directory = ""; }
                catch (NotSupportedException) { directory = ""; }
                catch (PathTooLongException) { directory = ""; }
                if (Directory.Exists(directory))
                    picker.SelectedPath = directory;
                if (picker.ShowDialog(this) == DialogResult.OK)
                    input.Text = picker.SelectedPath;
            }
        }

        private void BuildUnifiedSettings()
        {
            unifiedLeft.Dock = DockStyle.Fill;
            unifiedLeft.ColumnCount = 1;
            unifiedLeft.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            unifiedLeft.RowCount = 8;
            unifiedLeft.Padding = new Padding(16, 10, 16, 10);
            float[] rows = {9, 11, 11, 7, 29, 10, 14, 9};
            foreach(float percent in rows)
                unifiedLeft.RowStyles.Add(new RowStyle(SizeType.Percent, percent));
            unifiedPathPanel.Controls.Add(unifiedLeft);
            unifiedSectionTitle.Name = "iwxaSetupSectionTitle";
            unifiedSectionTitle.Text = T("Параметры установки",
                "Installation settings");
            unifiedSectionTitle.Font = new Font("Segoe UI", 13F, FontStyle.Bold);
            unifiedSectionTitle.ForeColor = Navy;
            unifiedSectionTitle.Dock = DockStyle.Fill;
            unifiedLeft.Controls.Add(unifiedSectionTitle, 0, 0);

            string[] labels = {T("Программа", "Application"),
                T("Личные данные", "Personal data"),
                T("Стороннее ПО", "Other software"),
                T("Модели", "Models"),
                T("Кэш", "Cache")};
            unifiedLeft.Controls.Add(UnifiedPathRow(labels[0],
                locationInputs[0] = new TextBox(), "iwxaSetupInstallRoot",
                () => ChooseUnifiedPath(locationInputs[0], labels[0])), 0, 1);

            var commonRow = UiTable(3, 25, 59, 16);
            commonRow.Controls.Add(UiLabel(T("Общая папка", "Shared folder"),
                9.25F), 0, 0);
            commonStorageInput.Name = "iwxaSetupCommonRoot";
            commonStorageInput.AccessibleName = T("Общая папка хранилищ",
                "Shared storage folder");
            commonStorageInput.Dock = DockStyle.Fill;
            commonStorageInput.Margin = new Padding(2, 5, 6, 5);
            commonStorageInput.BorderStyle = BorderStyle.FixedSingle;
            commonStorageInput.BackColor = Color.FromArgb(249, 251, 255);
            commonStorageInput.Font = new Font("Segoe UI", 9.25F);
            commonStorageInput.TextChanged += (sender, args) => {
                if (!updatingLocationInputs)
                    commonEditedByUser = true;
            };
            commonRow.Controls.Add(commonStorageInput, 1, 0);
            var commonPick = new Button {
                Text = T("Выбрать", "Browse"),
                Name = "iwxaSetupBrowseCommon",
                Dock = DockStyle.Fill, Margin = new Padding(0, 3, 0, 3),
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 8.5F),
                ForeColor = Navy, BackColor = Color.FromArgb(246, 249, 254)
            };
            commonPick.FlatAppearance.BorderColor = Line;
            commonPick.Click += (sender, args) => {
                ChooseUnifiedPath(commonStorageInput,
                    T("Общая папка хранения IWXA", "Shared IWXA storage folder"));
                if (!String.IsNullOrWhiteSpace(commonStorageInput.Text))
                    ApplyCommonStorage(commonStorageInput.Text);
            };
            commonStorageInput.Leave += (sender, args) => {
                if (!commonEditedByUser ||
                    String.IsNullOrWhiteSpace(commonStorageInput.Text)) return;
                try { ApplyCommonStorage(commonStorageInput.Text); }
                catch (Exception ex) { ShowLocationError(ex); }
                commonEditedByUser = false;
            };
            commonRow.Controls.Add(commonPick, 2, 0);
            unifiedLeft.Controls.Add(commonRow, 0, 2);
            // Explain that the common root fills the four storage paths.
            // It does not move existing data until the user explicitly asks.
            var sharedHelpText = T(
                "Общая папка → Data, Software, Models и Cache. Можно изменить отдельно.",
                "Shared folder → Data, Software, Models and Cache. Each path remains editable.");
            var sharedHelp = UiLabel(sharedHelpText, 8.75F, false, Secondary);
            unifiedLeft.Controls.Add(sharedHelp, 0, 3);
            detailsHint.SetToolTip(commonStorageInput, T(
                "При выборе общей папки автоматически задаются подпапки Data, Software, Models и Cache. Файлы не перемещаются до подтверждения.",
                "Selecting this root fills Data, Software, Models and Cache. Files are not moved until confirmed."));
            detailsHint.SetToolTip(sharedHelp, sharedHelpText);

            var storageGrid = UiTable(2, 50, 50);
            storageGrid.RowCount = 2;
            storageGrid.RowStyles.Clear();
            storageGrid.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
            storageGrid.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
            for(int i=1;i<=4;i++)
            {
                int index = i;
                var cell = UiTable(1, 100);
                cell.RowCount = 2;
                cell.RowStyles.Add(new RowStyle(SizeType.Percent, 37));
                cell.RowStyles.Add(new RowStyle(SizeType.Percent, 63));
                cell.Padding = new Padding(i % 2 == 0 ? 9 : 0, 0, 8, 0);
                cell.Controls.Add(UiLabel(labels[i], 9F, false, Navy), 0, 0);
                var entry = UiTable(2, 85, 15);
                var input = new TextBox {
                    Name = new [] { "", "iwxaSetupDataRoot",
                        "iwxaSetupSoftwareRoot", "iwxaSetupModelsRoot",
                        "iwxaSetupCacheRoot" }[i],
                    Font = new Font("Segoe UI", 9F),
                    Dock = DockStyle.Fill, Margin = new Padding(0, 3, 5, 4),
                    BackColor = Color.FromArgb(249, 251, 255),
                    BorderStyle = BorderStyle.FixedSingle,
                    AccessibleName = labels[i]
                };
                input.TextChanged += (sender, args) => MarkLocationsChanged();
                locationInputs[i] = input;
                entry.Controls.Add(input, 0, 0);
                var pick = new Button {
                    Name = "iwxaSetupBrowse" + i,
                    Text = "…", Dock = DockStyle.Fill,
                    AccessibleName = T("Выбрать папку: ", "Choose folder: ") + labels[i],
                    Margin = new Padding(0, 2, 0, 3),
                    BackColor = Color.FromArgb(246, 249, 254),
                    ForeColor = Navy, FlatStyle = FlatStyle.Flat,
                    Font = new Font("Segoe UI", 11F, FontStyle.Bold)
                };
                pick.FlatAppearance.BorderColor = Line;
                pick.Click += (sender, args) =>
                    ChooseUnifiedPath(locationInputs[index], labels[index]);
                entry.Controls.Add(pick, 1, 0);
                cell.Controls.Add(entry, 0, 1);
                storageGrid.Controls.Add(cell, (i - 1) % 2, (i - 1) / 2);
            }
            unifiedLeft.Controls.Add(storageGrid, 0, 4);

            var startup = UiTable(2, 54, 46);
            launchAtLogin.Name = "iwxaSetupInlineAutostart";
            launchAtLogin.Text = T("Запускать вместе с Windows",
                "Start with Windows");
            launchAtLogin.Font = new Font("Segoe UI", 9.25F);
            launchAtLogin.ForeColor = Navy;
            launchAtLogin.Dock = DockStyle.Fill;
            launchAtLogin.CheckedChanged += (sender, args) =>
                MarkLocationsChanged();
            startup.Controls.Add(launchAtLogin, 0, 0);
            launchAfterSetup.Text = T("Открыть после установки",
                "Launch after installation");
            launchAfterSetup.Font = new Font("Segoe UI", 9.25F);
            launchAfterSetup.ForeColor = Navy;
            launchAfterSetup.Dock = DockStyle.Fill;
            startup.Controls.Add(launchAfterSetup, 1, 0);
            unifiedLeft.Controls.Add(startup, 0, 5);

            var components = UiTable(3, 54, 24, 22);
            componentStatus.Name = "iwxaSetupWebView2Status";
            componentStatus.Text = T("Проверяем Microsoft WebView2",
                "Checking Microsoft WebView2");
            componentStatus.ForeColor = Secondary;
            componentStatus.TextAlign = ContentAlignment.MiddleLeft;
            componentStatus.Font = new Font("Segoe UI", 9F);
            componentStatus.Dock = DockStyle.Fill;
            components.Controls.Add(componentStatus, 0, 0);
            webOnline.Visible = false;
            webOnline.Name = "iwxaSetupInstallWebView2Online";
            webOnline.Text = T("Установить", "Install");
            SetupButton(webOnline, false, 98);
            webOnline.Dock = DockStyle.Fill;
            webOnline.Margin = new Padding(3, 7, 3, 7);
            webOnline.Click += async (sender, args) =>
                await ExecuteAsync(SetupOperation.InstallWebView2);
            components.Controls.Add(webOnline, 1, 0);
            webOffline.Visible = false;
            webOffline.Name = "iwxaSetupInstallWebView2Offline";
            webOffline.Text = T("Из файла…", "From file…");
            SetupButton(webOffline, false, 91);
            webOffline.Dock = DockStyle.Fill;
            webOffline.Margin = new Padding(3, 7, 0, 7);
            webOffline.Click += async (sender, args) =>
                await ExecuteAsync(SetupOperation.InstallWebView2Offline);
            components.Controls.Add(webOffline, 2, 0);
            unifiedLeft.Controls.Add(components, 0, 6);

            draftNotice.Name = "iwxaSetupUnsavedNote";
            draftNotice.Text = T("Укажите папки и нажмите «Установить».",
                "Choose locations, then select Install.");
            draftNotice.Font = new Font("Segoe UI", 9F);
            draftNotice.ForeColor = Secondary;
            draftNotice.Dock = DockStyle.Fill;
            unifiedLeft.Controls.Add(draftNotice, 0, 7);
        }

        private void BuildUnifiedStatus(Panel card)
        {
            unifiedRight.Dock = DockStyle.Fill;
            unifiedRight.ColumnCount = 1;
            unifiedRight.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            unifiedRight.RowCount = 10;
            float[] rows = {8, 12, 10, 19, 4, 8, 9, 9, 10, 11};
            foreach (float percent in rows)
                unifiedRight.RowStyles.Add(new RowStyle(SizeType.Percent, percent));
            card.Controls.Add(unifiedRight);
            unifiedRight.Controls.Add(UiLabel(T("Состояние", "Status"),
                13, true), 0, 0);
            status.Name = "iwxaSetupStatus";
            status.Text = T("Проверяем установку", "Checking installation");
            status.Dock = DockStyle.Fill;
            status.Font = new Font("Segoe UI", 13.5F, FontStyle.Bold);
            status.TextAlign = ContentAlignment.MiddleLeft;
            status.ForeColor = Navy;
            status.AutoEllipsis = false;
            unifiedRight.Controls.Add(status, 0, 1);
            version.Name = "iwxaSetupVersion";
            version.ForeColor = Secondary;
            version.Font = new Font("Segoe UI", 8.75F);
            version.Dock = DockStyle.Fill;
            unifiedRight.Controls.Add(version, 0, 2);
            unifiedExplanation.Name = "iwxaSetupStatusExplanation";
            unifiedExplanation.Text = T(
                "Проверяем состояние программы и выбранных папок.",
                "Checking the application and chosen locations.");
            unifiedExplanation.Dock = DockStyle.Fill;
            unifiedExplanation.Font = new Font("Segoe UI", 9.25F);
            unifiedExplanation.ForeColor = Color.FromArgb(62, 82, 112);
            unifiedExplanation.TextAlign = ContentAlignment.TopLeft;
            unifiedRight.Controls.Add(unifiedExplanation, 0, 3);
            packageDetails.TextChanged += (sender, args) =>
                RefreshUnifiedExplanation();
            busyProgress.Name = "iwxaSetupActivity";
            busyProgress.Dock = DockStyle.Fill;
            busyProgress.Style = ProgressBarStyle.Marquee;
            busyProgress.Visible = false;
            unifiedRight.Controls.Add(busyProgress, 0, 4);
            unifiedManageTitle.Text = T("Доступные действия", "Available actions");
            unifiedManageTitle.ForeColor = Navy;
            unifiedManageTitle.Font =
                new Font("Segoe UI", 11F, FontStyle.Bold);
            unifiedManageTitle.Dock = DockStyle.Fill;
            unifiedRight.Controls.Add(unifiedManageTitle, 0, 5);
            unifiedActionBox.Dock = DockStyle.Fill;
            unifiedActionBox.BackColor = Color.White;
            unifiedRight.Controls.Add(unifiedActionBox, 0, 6);
            unifiedRight.SetRowSpan(unifiedActionBox, 3);
            unifiedActionGrid.Dock = DockStyle.Fill;
            unifiedActionGrid.ColumnCount = 1;
            unifiedActionGrid.RowCount = 3;
            unifiedActionGrid.ColumnStyles.Add(
                new ColumnStyle(SizeType.Percent, 100));
            foreach(float part in new [] {33F, 33F, 34F})
                unifiedActionGrid.RowStyles.Add(
                    new RowStyle(SizeType.Percent, part));
            unifiedActionBox.Controls.Add(unifiedActionGrid);
            unifiedReadyNotes.Dock = DockStyle.Fill;
            unifiedReadyNotes.Font = new Font("Segoe UI", 9.25F);
            unifiedReadyNotes.ForeColor = Secondary;
            unifiedReadyNotes.TextAlign = ContentAlignment.TopLeft;
            unifiedReadyNotes.Visible = false;
            unifiedActionBox.Controls.Add(unifiedReadyNotes);
            // First installation: show an optional, unchecked, explicit data
            // import when the earlier Admin Center data directory has files.
            priorDataChoices.Dock = DockStyle.Fill;
            priorDataChoices.ColumnCount = 1;
            priorDataChoices.RowCount = 2;
            priorDataChoices.ColumnStyles.Add(
                new ColumnStyle(SizeType.Percent, 100));
            priorDataChoices.RowStyles.Add(new RowStyle(SizeType.Percent, 39));
            priorDataChoices.RowStyles.Add(new RowStyle(SizeType.Percent, 61));
            priorDataChoices.Visible = false;
            priorDataChoices.BackColor = Color.White;
            copyPriorData.Name = "iwxaSetupCopyPriorData";
            copyPriorData.Text = T("Перенести прежние данные",
                "Transfer existing data");
            copyPriorData.Font = new Font("Segoe UI", 10F, FontStyle.Bold);
            copyPriorData.ForeColor = Navy;
            copyPriorData.Dock = DockStyle.Fill;
            copyPriorData.Checked = false;
            copyPriorData.CheckedChanged += (sender, args) =>
                RefreshUnifiedButtons();
            priorDataChoices.Controls.Add(copyPriorData, 0, 0);
            copyPriorDataDetails.Text = T(
                "Копирование с проверкой. Прежняя папка сохранится.",
                "Verified copy. The original folder will be retained.");
            copyPriorDataDetails.Dock = DockStyle.Fill;
            copyPriorDataDetails.Font = new Font("Segoe UI", 8.75F);
            copyPriorDataDetails.ForeColor = Secondary;
            copyPriorDataDetails.AutoEllipsis = false;
            priorDataChoices.Controls.Add(copyPriorDataDetails, 0, 1);
            unifiedActionBox.Controls.Add(priorDataChoices);
            openApplication.Visible = false;
            openApplication.Name = "iwxaSetupRelatedAction";
            openApplication.Text = T("Открыть программу",
                "Open application");
            openApplication.Font = new Font("Segoe UI", 10F);
            openApplication.LinkColor = Accent;
            openApplication.Dock = DockStyle.Fill;
            openApplication.TextAlign = ContentAlignment.MiddleLeft;
            openApplication.LinkClicked += (sender, args) =>
                OpenRelatedAction();
            unifiedActionGrid.Controls.Add(openApplication, 0, 0);
            serviceOwnedSetup.Visible = false;
            serviceOwnedSetup.Name = "iwxaSetupOpenInstalledMaintenance";
            serviceOwnedSetup.Text = T("Восстановить установленный выпуск",
                "Repair installed release");
            SetupButton(serviceOwnedSetup, false, 160);
            serviceOwnedSetup.Dock = DockStyle.Fill;
            serviceOwnedSetup.Margin = new Padding(0, 1, 0, 2);
            serviceOwnedSetup.Click += (sender, args) =>
                OpenInstalledMaintenance();
            unifiedActionGrid.Controls.Add(serviceOwnedSetup, 0, 1);
            removeApplication.Visible = false;
            removeApplication.Name = "iwxaSetupRemoveApplication";
            removeApplication.Text = T("Удалить программу…",
                "Uninstall application…");
            SetupButton(removeApplication, false, 180);
            removeApplication.ForeColor = Color.FromArgb(162, 51, 61);
            removeApplication.FlatAppearance.BorderColor =
                Color.FromArgb(229, 187, 193);
            removeApplication.Dock = DockStyle.Fill;
            removeApplication.Margin = new Padding(0, 2, 0, 0);
            removeApplication.Click += async (sender, args) =>
                await BeginUninstallAsync();
            unifiedActionGrid.Controls.Add(removeApplication, 0, 2);
            compactSettings.Name = "iwxaSetupCompactSettings";
            compactSettings.Text = T("Настроить папки и запуск…",
                "Configure folders and startup…");
            compactSettings.Dock = DockStyle.Fill;
            compactSettings.Margin = new Padding(0, 4, 0, 4);
            SetupButton(compactSettings, false, 240);
            compactSettings.Click += (sender, args) => OpenCompactSettings();
            compactSettings.Visible = false;
            unifiedRight.Controls.Add(compactSettings, 0, 9);
        }

        private void RefreshUnifiedExplanation()
        {
            if (unifiedExplanation == null) return;
            string reason = inspectedStatus ?? "";
            string message;
            switch (reason)
            {
                case "NO_OWNED_INSTALLATION":
                    message = primaryAction == SetupOperation.None &&
                        !String.IsNullOrWhiteSpace(packageDetails.Text) ?
                        packageDetails.Text :
                        T("Программа ещё не установлена. Проверьте папки и начните установку.",
                          "The application is not installed. Review folders and install.");
                    break;
                case "SAME_VERSION_DIFFERENT_PACKAGE":
                    message = T("Установлена другая сборка. Её можно открыть, обслужить или удалить. Этот пакет не заменяет её автоматически.",
                        "Another build is installed. You can open, maintain or uninstall it. This package will not replace it automatically.");
                    break;
                case "DOWNGRADE_BLOCKED":
                case "VERSION_UNSUPPORTED":
                    message = T("На компьютере уже есть другой выпуск. Настройки и удаление доступны, замена этим пакетом недоступна.",
                        "Another release is installed. Settings and uninstall remain available, but this package cannot replace it.");
                    break;
                case "APPLICATION_RUNNING":
                    message = T("Закройте работающую программу и нажмите «Проверить», чтобы продолжить обслуживание.",
                        "Close the running application, then select Check to continue maintenance.");
                    break;
                case "WEBVIEW2_MISSING":
                    message = T("Нужен Microsoft WebView2. Установите его ниже и повторите проверку.",
                        "Microsoft WebView2 is required. Install it below, then recheck.");
                    break;
                case "START_MENU_SHORTCUT_CONFLICT":
                    message = T("Другая программа использует это имя ярлыка. Сохраните или переименуйте существующий ярлык, затем повторите проверку.",
                        "Another application uses this shortcut name. Keep or rename the existing shortcut, then check again.");
                    break;
                case "LEGACY_MIGRATION_HOLD":
                case "LEGACY_MIGRATION_REVIEW_REQUIRED":
                    message = T("Обнаружена старая установка. Она сохранена; проверьте предложенное действие перед переходом.",
                        "An earlier installation was found. It is preserved; review the proposed action before migration.");
                    break;
                case "LEGACY_SWITCH_RECOVERY_REQUIRED":
                    message = T("Переключение запуска прервалось. Восстановите прежний ярлык и повторите проверку.",
                        "The launch switch was interrupted. Restore the previous shortcut and check again.");
                    break;
                case "UPGRADE_PENDING_CONFIRMATION":
                case "REPAIR_PENDING_CONFIRMATION_NO_ROLLBACK":
                    message = T("Проверьте установленную версию и завершите обновление. Личные данные сохранены.",
                        "Check the installed release and finish the update. Your data is preserved.");
                    break;
                case "UPGRADE_RECOVERY_REQUIRED":
                    message = T("Прерванную операцию необходимо завершить восстановлением. Личные данные не удаляются.",
                        "The interrupted operation requires recovery. Your data is not removed.");
                    break;
                default:
                    message = !String.IsNullOrWhiteSpace(packageDetails.Text) &&
                        packageDetails.Text.Length <= 175 ?
                        packageDetails.Text :
                        T("Выберите доступное действие. При обслуживании личные данные сохраняются.",
                          "Choose an available action. Your data is preserved during maintenance.");
                    break;
            }
            if (status.Text.StartsWith(
                    T("Недостаточно места", "Not enough free disk"),
                    StringComparison.OrdinalIgnoreCase) &&
                !String.IsNullOrWhiteSpace(packageDetails.Text))
                message = packageDetails.Text;
            unifiedExplanation.Text = message;
            detailsHint.SetToolTip(unifiedExplanation,
                String.IsNullOrWhiteSpace(packageDetails.Text) ?
                    message : packageDetails.Text);
        }

        private async Task UnifiedPrimaryAsync()
        {
            if (performingOperation || verifyingState || inspectedBundle == null)
                return;
            bool first = inspectedStatus == "NO_OWNED_INSTALLATION";
            bool hadChanges = locationDraftChanged;
            if (hadChanges)
            {
                // First validate the edited location and re-run the actual
                // Windows preflight. Never start the previously selected
                // operation against stale paths.
                await SaveExperienceLocationsAsync();
                if (locationDraftChanged) return;
                if (first && primaryAction != SetupOperation.Install)
                    return;
            }
            if (primaryAction != SetupOperation.None)
                await ExecuteAsync(primaryAction);
            else if (!first)
                await VerifyAsync();
        }

        private void RefreshUnifiedButtons()
        {
            if (unifiedMain.ColumnCount == 0) return;
            bool ready = !performingOperation && !verifyingState;
            bool first = inspectedStatus == "NO_OWNED_INSTALLATION";
            bool installed = inspectedBundle != null && !first;
            bool changes = locationDraftChanged;
            bool canCopyPriorData = first && inspectedBundle != null &&
                locationInputs[1] != null &&
                SetupInstallation.HasPreservedDefaultData(
                    inspectedBundle, locationInputs[1].Text);
            bool transferDestinationReady = canCopyPriorData &&
                SetupInstallation.IsUnusedStorageTarget(
                    locationInputs[1].Text);
            if ((!canCopyPriorData || !transferDestinationReady) &&
                copyPriorData.Checked)
                copyPriorData.Checked = false;
            copyPriorData.Enabled = ready && transferDestinationReady;
            priorDataChoices.Visible = canCopyPriorData;
            unifiedManageTitle.Text = canCopyPriorData ?
                T("Найдены прежние данные", "Existing data found") :
                first ? T("Перед установкой", "Before installation") :
                T("Управление программой", "Manage application");
            unifiedReadyNotes.Visible = first && !canCopyPriorData;
            unifiedActionGrid.Visible = !first;
            if (first)
            {
                if (canCopyPriorData)
                {
                    string source = SetupInstallation.DefaultLocations(
                        inspectedBundle).DataRoot;
                    string destination = locationInputs[1].Text;
                    copyPriorDataDetails.Text = !transferDestinationReady ?
                        T("Для переноса выберите новую пустую папку данных.",
                          "Choose a new empty data folder to enable transfer.") :
                        copyPriorData.Checked ?
                        T("Скопируем с проверкой. Прежние файлы сохранятся.",
                          "Copy and verify. Original files will be preserved.") :
                        T("Без переноса: прежние файлы останутся на месте.",
                          "Without transfer: original files stay in place.");
                    detailsHint.SetToolTip(copyPriorDataDetails,
                        T("Откуда: ", "From: ") + source +
                        Environment.NewLine +
                        T("Куда: ", "To: ") + destination);
                    priorDataChoices.BringToFront();
                }
                else
                {
                    unifiedReadyNotes.Text =
                        primaryAction == SetupOperation.Install ?
                        T("Пакет проверен. Вы можете изменить папки и параметры запуска перед установкой.",
                          "Package verified. You can change folders and startup before installing.") :
                        T("Проверьте состояние выше. Установка станет доступна после устранения препятствия.",
                          "Review the status above. Resolve the blocker to install.");
                    unifiedReadyNotes.BringToFront();
                }
            }

            // Even if the OLD path was blocked, an edited first-install
            // directory must offer a clear way to recheck and install.
            bool editedFirstInstall = first && inspectedBundle != null && changes;
            install.Visible = editedFirstInstall ||
                (primaryAction != SetupOperation.None && (!changes || first));
            install.Enabled = ready &&
                (primaryAction != SetupOperation.None || editedFirstInstall);
            if (editedFirstInstall)
                install.Text = T("Проверить и установить", "Check and install");
            applyLocations.Visible = changes && !first;
            applyLocations.Enabled = ready && inspectedBundle != null;
            discardLocations.Visible = changes;
            discardLocations.Enabled = ready;
            secondary.Visible = secondaryAction != SetupOperation.None && !changes;
            secondary.Enabled = ready && secondaryAction != SetupOperation.None;
            retry.Visible = ready && inspectedBundle != null;
            retry.Enabled = ready;
            cancelStorageMove.Enabled = ready || storageCancellation != null;
            serviceOwnedSetup.Visible = installed &&
                (inspectedStatus == "SAME_VERSION_DIFFERENT_PACKAGE" ||
                 inspectedStatus == "DOWNGRADE_BLOCKED" ||
                 inspectedStatus == "VERSION_UNSUPPORTED");
            serviceOwnedSetup.Enabled = ready && serviceOwnedSetup.Visible;
            openApplication.Enabled = ready && openApplication.Visible;
            removeApplication.Enabled = ready && removeApplication.Visible;
            unifiedSectionTitle.Text = first ?
                T("Параметры установки", "Installation settings") :
                T("Папки и запуск", "Folders and startup");
            if (inspectedBundle == null)
                draftNotice.Text = T("Проверяем выбранные параметры…",
                    "Checking selected settings…");
            else if (!changes)
                draftNotice.Text = first ?
                    T("Папки можно изменить перед установкой.",
                      "You can change folders before installing.") :
                    T("Действующие настройки программы.",
                      "Current application settings.");
            else
                draftNotice.Text = first ?
                    T("Изменения будут применены при установке.",
                      "Changes will be applied during installation.") :
                    T("Параметры изменены. Нажмите «Применить».",
                      "Settings changed. Select Apply.");

            // Do not demand an artificial initial install to the default
            // directory. Explain the retained files inline and keep Install
            // available for the chosen location.
            if (first && inspectedBundle != null &&
                locationInputs[1] != null &&
                SetupInstallation.HasPreservedDefaultData(
                    inspectedBundle, locationInputs[1].Text))
            {
                draftNotice.Text = copyPriorData.Checked ?
                    T("Перенос выбран — прежние файлы сохранятся.",
                      "Transfer selected — original files will stay.") :
                    T("Прежние данные останутся на месте.",
                      "Existing data will remain in place.");
                detailsHint.SetToolTip(draftNotice, T(
                    "Данные из стандартной папки не переносятся автоматически: ",
                    "Existing files are not automatically moved from: ") +
                    SetupInstallation.DefaultLocations(inspectedBundle).DataRoot);
            }
            else
                detailsHint.SetToolTip(draftNotice, draftNotice.Text);

            if (inspectedBundle != null)
                Text = inspectedBundle.Name + " - " +
                    T("Установка и обслуживание", "Install and maintain");
            // Windows Forms wraps a long version string only if two lines
            // are explicitly available. Do not truncate the installed and
            // package versions inside a one-line card.
            if (version.Text != null &&
                version.Text.IndexOf("    ·    ", StringComparison.Ordinal) >= 0)
                version.Text = version.Text.Replace("    ·    ",
                    Environment.NewLine);
            if (unifiedBrand.Image != null && inspectedBundle != null)
            {
                // Asset is unchanged unless product identity actually changes.
                Color productColor = ProductBrand(inspectedBundle);
                if (lastProductBrand != productColor.ToArgb())
                {
                    var old = unifiedBrand.Image;
                    unifiedBrand.Image = BrandMark(productColor);
                    lastProductBrand = productColor.ToArgb();
                    old.Dispose();
                }
            }
            RefreshUnifiedExplanation();
            AdjustUnifiedForScreen();
        }
        private int lastProductBrand;

        private void FocusUnifiedProgress()
        {
            if (unifiedExplanation != null)
                unifiedExplanation.Text = T("Выполняем выбранное действие…",
                    "Running the selected operation…");
        }

        private void OpenCompactSettings()
        {
            if (!unifiedCompact || performingOperation || verifyingState) return;
            using (var dialog = new Form {
                Text = T("Папки и запуск", "Folders and startup"),
                StartPosition = FormStartPosition.CenterParent,
                ClientSize = new Size(705, 405),
                MinimumSize = new Size(570, 345),
                MaximizeBox = false, BackColor = Color.White,
                AutoScaleMode = AutoScaleMode.Dpi,
                Font = new Font("Segoe UI", 9.5F)
            })
            {
                var root = UiTable(1, 100);
                root.RowCount = 3;
                root.RowStyles.Add(new RowStyle(SizeType.Percent, 17));
                root.RowStyles.Add(new RowStyle(SizeType.Percent, 65));
                root.RowStyles.Add(new RowStyle(SizeType.Percent, 18));
                root.Padding = new Padding(18, 12, 18, 10);
                dialog.Controls.Add(root);
                var header = UiLabel(T("Расположения и параметры запуска",
                    "Storage and startup settings"), 14F, true);
                root.Controls.Add(header, 0, 0);
                var stages = new Panel {
                    Dock = DockStyle.Fill, BackColor = Color.White
                };
                root.Controls.Add(stages, 0, 1);
                var first = UiTable(1, 100);
                var second = UiTable(1, 100);
                first.RowCount = second.RowCount = 4;
                for (int i = 0; i < 4; i++) {
                    first.RowStyles.Add(new RowStyle(SizeType.Percent, 25));
                    second.RowStyles.Add(new RowStyle(SizeType.Percent, 25));
                }
                stages.Controls.Add(first);
                stages.Controls.Add(second);
                var edits = new TextBox[5];
                for(int i=0;i<5;i++)
                    edits[i] = new TextBox {
                        Text = locationInputs[i].Text,
                        ReadOnly = i==0 && inspectedStatus!="NO_OWNED_INSTALLATION"
                    };
                string[] labels = {
                    T("Программа", "Application"),
                    T("Личные данные", "Personal data"),
                    T("Сторонние программы", "External software"),
                    T("Модели", "Models"), T("Кэш", "Cache")
                };
                var common = new TextBox {Text = commonStorageInput.Text};
                Action<string> setCommon = path => {
                    if (String.IsNullOrWhiteSpace(path)) return;
                    string rootPath = Path.GetFullPath(path);
                    common.Text = rootPath;
                    string[] parts = {"Data", "Software", "Models", "Cache"};
                    for (int i=1;i<=4;i++)
                        edits[i].Text = Path.Combine(rootPath, parts[i-1]);
                };
                Action<TableLayoutPanel,int,string,TextBox,bool> addRow =
                    (table,index,label,input,shared) =>
                {
                    var row = UiTable(3, 27, 61, 12);
                    row.Controls.Add(UiLabel(label, 9.5F), 0, 0);
                    input.Dock = DockStyle.Fill;
                    input.Font = new Font("Segoe UI", 9.5F);
                    input.Margin = new Padding(0, 8, 6, 8);
                    row.Controls.Add(input, 1, 0);
                    var browse = new Button {
                        Text = "…", Dock = DockStyle.Fill,
                        Font = new Font("Segoe UI", 12F),
                        Margin = new Padding(0, 5, 0, 5),
                        AccessibleName = T("Выбрать: ","Browse: ") + label
                    };
                    StyleSecondaryButton(browse);
                    browse.Enabled = !input.ReadOnly;
                    browse.Click += (sender,args) => {
                        using (var picker = new FolderBrowserDialog {
                            Description = label, ShowNewFolderButton = true
                        })
                        {
                            if (Directory.Exists(input.Text))
                                picker.SelectedPath = input.Text;
                            if (picker.ShowDialog(dialog) != DialogResult.OK) return;
                            if (shared) setCommon(picker.SelectedPath);
                            else input.Text = picker.SelectedPath;
                        }
                    };
                    row.Controls.Add(browse, 2, 0);
                    table.Controls.Add(row, 0, index);
                };
                addRow(first,0,labels[0],edits[0],false);
                addRow(first,1,T("Общая папка","Shared folder"),common,true);
                addRow(first,2,labels[1],edits[1],false);
                addRow(first,3,labels[2],edits[2],false);
                addRow(second,0,labels[3],edits[3],false);
                addRow(second,1,labels[4],edits[4],false);
                var startChoice = new CheckBox {
                    Text = T("Запускать вместе с Windows","Start with Windows"),
                    Dock = DockStyle.Fill,
                    Checked = launchAtLogin.Checked
                };
                second.Controls.Add(startChoice,0,2);
                var launchChoice = new CheckBox {
                    Text = T("Открыть после установки","Launch after installation"),
                    Dock = DockStyle.Fill,
                    Checked = launchAfterSetup.Checked,
                    Enabled = launchAfterSetup.Enabled
                };
                second.Controls.Add(launchChoice,0,3);
                var footer = UiTable(3, 33, 33, 34);
                root.Controls.Add(footer, 0, 2);
                var back = new Button {Text = T("Назад","Back"),
                    Dock = DockStyle.Fill,Margin=new Padding(4,5,8,5)};
                var cancel = new Button {Text = T("Отмена","Cancel"),
                    Dock=DockStyle.Fill,Margin=new Padding(4,5,8,5),
                    DialogResult=DialogResult.Cancel};
                var next = new Button {Text = T("Далее","Next"),
                    Dock=DockStyle.Fill,Margin=new Padding(4,5,4,5)};
                StyleSecondaryButton(back);
                StyleSecondaryButton(cancel);
                next.BackColor = Accent;
                next.ForeColor = Color.White;
                next.FlatStyle = FlatStyle.Flat;
                next.FlatAppearance.BorderSize = 0;
                footer.Controls.Add(back,0,0);
                footer.Controls.Add(cancel,1,0);
                footer.Controls.Add(next,2,0);
                int stage = 0;
                Action refresh = () => {
                    first.Visible = stage == 0;
                    second.Visible = stage == 1;
                    if(stage==0)first.BringToFront();
                    else second.BringToFront();
                    back.Enabled = stage!=0;
                    next.Text = stage==0?T("Далее","Next"):T("Применить","Apply");
                    dialog.AcceptButton = next;
                };
                back.Click += (sender,args)=>{stage=0;refresh();};
                next.Click += (sender,args)=> {
                    if(stage==0) {
                        if (!String.IsNullOrWhiteSpace(common.Text) &&
                            !String.Equals(common.Text,
                                commonStorageInput.Text,
                                StringComparison.OrdinalIgnoreCase))
                        {
                            try {setCommon(common.Text);}
                            catch(Exception ex){
                                MessageBox.Show(dialog,ex.Message,
                                    T("Папка хранения","Storage folder"));
                                return;
                            }
                        }
                        stage=1;refresh();return;
                    }
                    for(int i=0;i<5;i++)
                        locationInputs[i].Text = edits[i].Text;
                    commonStorageInput.Text = common.Text;
                    launchAtLogin.Checked = startChoice.Checked;
                    launchAfterSetup.Checked = launchChoice.Checked;
                    MarkLocationsChanged();
                    dialog.DialogResult=DialogResult.OK;
                };
                dialog.CancelButton = cancel;
                dialog.Shown += (sender,args)=>FitDialogToWorkingArea(dialog);
                refresh();
                dialog.ShowDialog(this);
            }
        }

        private void AdjustUnifiedForScreen()
        {
            if (resizingUnified || unifiedMain == null ||
                unifiedMain.ColumnStyles.Count < 2) return;
            resizingUnified = true;
            try
            {
                bool small = ClientSize.Width < 910 || ClientSize.Height < 570;
                // Compact high-DPI screens use a sequential settings dialog,
                // not a page with scrollbars or clipped form controls.
                unifiedCompact = small;
                unifiedPathPanel.Visible = !small;
                compactSettings.Visible = small;
                if (small)
                {
                    unifiedMain.ColumnStyles[0].Width = 0;
                    unifiedMain.ColumnStyles[1].Width = 100;
                }
                else
                {
                    unifiedMain.ColumnStyles[0].Width = 65;
                    unifiedMain.ColumnStyles[1].Width = 35;
                }
            }
            finally { resizingUnified = false; }
        }
    }
}

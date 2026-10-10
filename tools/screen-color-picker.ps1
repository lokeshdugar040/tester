param(
  [Parameter(Mandatory = $true)][string]$ResultFile,
  [Parameter(Mandatory = $true)][string]$CancelFile
)

$ErrorActionPreference = 'Stop'

$source = @'
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

public sealed class ReboundScreenColorPicker : Form
{
    private const int WH_MOUSE_LL = 14;
    private const int WM_LBUTTONDOWN = 0x0201;

    private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    private static HookProc mouseProc = MouseHook;
    private static IntPtr mouseHook;
    private static string resultFile;
    private static string cancelFile;
    private static string result;
    private static Timer cancelTimer;

    [StructLayout(LayoutKind.Sequential)]
    private struct Point
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseData
    {
        public Point Cursor;
        public uint MouseDataValue;
        public uint Flags;
        public uint Time;
        public IntPtr ExtraInfo;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr module, uint threadId);
    [DllImport("user32.dll")]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string moduleName);
    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll")]
    private static extern uint GetPixel(IntPtr dc, int x, int y);
    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    private ReboundScreenColorPicker()
    {
        Text = "Rebound Screen Color";
        FormBorderStyle = FormBorderStyle.FixedToolWindow;
        StartPosition = FormStartPosition.Manual;
        TopMost = true;
        ShowInTaskbar = false;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(330, 72);

        var label = new Label();
        label.Dock = DockStyle.Fill;
        label.TextAlign = ContentAlignment.MiddleCenter;
        label.Font = new Font("Segoe UI", 10F, FontStyle.Regular);
        label.Text = "Click any screen pixel to sample it";
        Controls.Add(label);

        var area = Screen.PrimaryScreen.WorkingArea;
        Location = new System.Drawing.Point(
            area.Left + (area.Width - Width) / 2,
            area.Bottom - Height - 18);
    }

    public static string Run(string outputPath, string cancelPath)
    {
        resultFile = outputPath;
        cancelFile = cancelPath;
        result = null;
        SetProcessDPIAware();

        using (var form = new ReboundScreenColorPicker())
        {
            form.Shown += delegate
            {
                var module = GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName);
                mouseHook = SetWindowsHookEx(WH_MOUSE_LL, mouseProc, module, 0);
                if (mouseHook == IntPtr.Zero)
                {
                    result = "ERROR|Could not install the screen mouse hook.";
                    form.Close();
                    return;
                }

                WriteResult("READY");
                cancelTimer = new Timer();
                cancelTimer.Interval = 200;
                cancelTimer.Tick += delegate
                {
                    if (File.Exists(cancelFile))
                    {
                        result = "CANCEL";
                        form.Close();
                    }
                };
                cancelTimer.Start();
            };
            Application.Run(form);
        }

        if (cancelTimer != null) cancelTimer.Dispose();
        if (mouseHook != IntPtr.Zero) UnhookWindowsHookEx(mouseHook);
        mouseHook = IntPtr.Zero;

        if (result == null) result = "CANCEL";
        WriteResult(result);
        return result;
    }

    private static IntPtr MouseHook(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0 && wParam.ToInt32() == WM_LBUTTONDOWN)
        {
            var data = (MouseData)Marshal.PtrToStructure(lParam, typeof(MouseData));
            var click = new System.Drawing.Point(data.Cursor.X, data.Cursor.Y);
            var form = Application.OpenForms.Count > 0 ? Application.OpenForms[0] : null;
            if (form == null || !form.Bounds.Contains(click))
            {
                var dc = GetDC(IntPtr.Zero);
                try
                {
                    var color = GetPixel(dc, data.Cursor.X, data.Cursor.Y);
                    if (color == 0xFFFFFFFF)
                    {
                        result = "ERROR|Could not read the screen pixel.";
                    }
                    else
                    {
                        var red = color & 0xFF;
                        var green = (color >> 8) & 0xFF;
                        var blue = (color >> 16) & 0xFF;
                        result = String.Format("OK|#{0:X2}{1:X2}{2:X2}", red, green, blue);
                    }
                }
                finally
                {
                    ReleaseDC(IntPtr.Zero, dc);
                }
                form.BeginInvoke(new MethodInvoker(form.Close));
            }
            return new IntPtr(1);
        }
        return CallNextHookEx(mouseHook, code, wParam, lParam);
    }

    private static void WriteResult(string value)
    {
        var temp = resultFile + ".tmp";
        File.WriteAllText(temp, value, Encoding.ASCII);
        if (File.Exists(resultFile)) File.Delete(resultFile);
        File.Move(temp, resultFile);
    }
}
'@

try {
  Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Windows.Forms.dll', 'System.Drawing.dll'
  [ReboundScreenColorPicker]::Run($ResultFile, $CancelFile) | Out-Null
} catch {
  [IO.File]::WriteAllText($ResultFile, ('ERROR|' + $_.Exception.Message), [Text.Encoding]::ASCII)
  exit 1
}

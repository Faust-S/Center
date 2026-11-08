using System;
using System.IO;
using System.Runtime.InteropServices;

namespace IwxaSetup
{
    // Experimental format V2: the existing ZIP, manifest and footer live
    // inside RT_RCDATA of the native PE image, not in its unsigned overlay.
    // Signing the final PE now covers the resource section, with no trailing
    // arbitrary bytes after the WIN_CERTIFICATE table.
    internal static class PeResourcePayload
    {
        private const uint DataFile = 0x2;
        private static readonly IntPtr TypeRcData = new IntPtr(10);
        private static readonly IntPtr ResourceId = new IntPtr(101);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode,
            EntryPoint = "LoadLibraryExW", SetLastError = true)]
        private static extern IntPtr LoadLibraryEx(
            string path, IntPtr reserved, uint flags);
        [DllImport("kernel32.dll", EntryPoint = "FindResourceW",
            SetLastError = true)]
        private static extern IntPtr FindResource(
            IntPtr module, IntPtr name, IntPtr type);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint SizeofResource(IntPtr module, IntPtr resource);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr LockResource(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool FreeLibrary(IntPtr handle);

        internal static Stream TryOpen(string exe)
        {
            // Loading as DATAFILE never executes application initialization.
            IntPtr module = LoadLibraryEx(exe, IntPtr.Zero, DataFile);
            if (module == IntPtr.Zero)
                return null;
            try
            {
                IntPtr found = FindResource(module, ResourceId, TypeRcData);
                if (found == IntPtr.Zero)
                    return null;
                uint length = SizeofResource(module, found);
                if (length < 136 || length > Int32.MaxValue)
                    throw new InvalidDataException("SETUP_RESOURCE_SIZE_INVALID");
                IntPtr loaded = LoadResource(module, found);
                IntPtr pointer = LockResource(loaded);
                if (loaded == IntPtr.Zero || pointer == IntPtr.Zero)
                    throw new InvalidDataException("SETUP_RESOURCE_LOCK_FAILED");
                Stream result = new NativeResourceStream(module, pointer, (int)length);
                module = IntPtr.Zero; // ownership transferred to stream
                return result;
            }
            finally
            {
                if (module != IntPtr.Zero) FreeLibrary(module);
            }
        }

        // Resource bytes remain mapped by Windows. Stream them into existing
        // ZIP/hash verifier rather than materializing the archive in RAM.
        private sealed class NativeResourceStream : Stream
        {
            private IntPtr module, pointer;
            private readonly long length;
            private long position;

            internal NativeResourceStream(IntPtr module, IntPtr pointer, int length)
            {
                this.module = module;
                this.pointer = pointer;
                this.length = length;
            }

            public override bool CanRead { get { return true; } }
            public override bool CanSeek { get { return true; } }
            public override bool CanWrite { get { return false; } }
            public override long Length { get { return length; } }
            public override long Position
            {
                get { return position; }
                set
                {
                    if (value < 0 || value > length)
                        throw new ArgumentOutOfRangeException("value");
                    position = value;
                }
            }
            public override int Read(byte[] buffer, int offset, int count)
            {
                if (module == IntPtr.Zero)
                    throw new ObjectDisposedException("NativeResourceStream");
                if (buffer == null) throw new ArgumentNullException("buffer");
                if (offset < 0 || count < 0 || offset > buffer.Length - count)
                    throw new ArgumentOutOfRangeException("offset");
                int amount = (int)Math.Min(count, length - position);
                if (amount > 0)
                {
                    Marshal.Copy(IntPtr.Add(pointer, (int)position),
                        buffer, offset, amount);
                    position += amount;
                }
                return amount;
            }
            public override long Seek(long offset, SeekOrigin origin)
            {
                long next = origin == SeekOrigin.Begin ? offset :
                    origin == SeekOrigin.Current ? checked(position + offset) :
                    origin == SeekOrigin.End ? checked(length + offset) :
                    throw new ArgumentOutOfRangeException("origin");
                Position = next;
                return next;
            }
            public override void Flush() { }
            public override void SetLength(long size)
            {
                throw new NotSupportedException();
            }
            public override void Write(byte[] data, int offset, int count)
            {
                throw new NotSupportedException();
            }
            protected override void Dispose(bool disposing)
            {
                if (module != IntPtr.Zero)
                {
                    FreeLibrary(module);
                    module = IntPtr.Zero;
                    pointer = IntPtr.Zero;
                }
                base.Dispose(disposing);
            }
        }
    }
}

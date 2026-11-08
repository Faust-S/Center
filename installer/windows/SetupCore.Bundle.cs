using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace IwxaSetup
{
    internal sealed class BundleInfo
    {
        internal string Id;
        internal string Name;
        internal string Publisher;
        internal string Version;
        internal string Architecture;
        internal string Entrypoint;
        internal string InstallDir;
        internal bool NeedsWebView2;
        internal long PayloadBytes;
        internal string SourceCommit;
        internal string PackageSha256;
        internal int FileCount;
    }

    // Exact binary contract shared with installer/build_bundle.py.
    // SHA-256 protects integrity, not publisher identity or code signing.
    internal static class BundleReader
    {
        private const int FooterSize = 136;
        private const int MaxManifestSize = 2 * 1024 * 1024;
        private const long MaxTotal = 4L * 1024 * 1024 * 1024;
        private const long MaxFile = 1024L * 1024 * 1024;
        private const int MaxFiles = 10000;
        private const int BufferSize = 1024 * 1024;
        private const string Magic = "IWXA_SETUP_CORE1";
        private const string Schema = "IWXA_SETUP_BUNDLE/1";
        private const string ProductSchema = "IWXA_SETUP_PRODUCT/1";

        private sealed class Expected
        {
            internal string Path;
            internal long Bytes;
            internal string Sha;
        }

        internal static BundleInfo Inspect(string executable)
        {
            return InspectOrStage(executable, null);
        }

        internal static BundleInfo ExtractVerified(string executable, string stagingRoot)
        {
            if (!Directory.Exists(stagingRoot) ||
                Directory.GetFileSystemEntries(stagingRoot).Length != 0 ||
                (File.GetAttributes(stagingRoot) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidDataException("SETUP_STAGING_ROOT_NOT_EMPTY_OR_UNTRUSTED");
            return InspectOrStage(executable, stagingRoot);
        }

        private static BundleInfo InspectOrStage(string executable, string stagingRoot)
        {
            using (var source = new FileStream(executable, FileMode.Open, FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete))
            using (var binary = new BinaryReader(source, Encoding.UTF8, true))
            {
                if (source.Length <= FooterSize + 1024)
                    throw new InvalidDataException("SETUP_PACKAGE_MISSING");

                source.Position = source.Length - FooterSize;
                byte[] magicBytes = binary.ReadBytes(16);
                if (magicBytes.Length != 16 ||
                    Encoding.ASCII.GetString(magicBytes) != Magic)
                    throw new InvalidDataException("SETUP_PACKAGE_MISSING");

                long stubLength = Size(binary.ReadUInt64(), "STUB_LENGTH_INVALID");
                long zipLength = Size(binary.ReadUInt64(), "ZIP_LENGTH_INVALID");
                long manifestLength = Size(binary.ReadUInt64(), "MANIFEST_LENGTH_INVALID");
                byte[] stubHash = binary.ReadBytes(32);
                byte[] zipHash = binary.ReadBytes(32);
                byte[] manifestHash = binary.ReadBytes(32);
                if (stubLength < 1024 || zipLength <= 0 ||
                    manifestLength <= 0 || manifestLength > MaxManifestSize ||
                    stubLength > source.Length ||
                    stubLength + zipLength > source.Length ||
                    stubLength + zipLength + manifestLength + FooterSize != source.Length)
                    throw new InvalidDataException("SETUP_LAYOUT_INVALID");

                if (!Same(HashRegion(source, 0, stubLength), stubHash))
                    throw new InvalidDataException("SETUP_STUB_HASH_INVALID");
                if (!Same(HashRegion(source, stubLength, zipLength), zipHash))
                    throw new InvalidDataException("SETUP_PACKAGE_HASH_INVALID");

                source.Position = stubLength + zipLength;
                byte[] metadata = binary.ReadBytes((int)manifestLength);
                if (metadata.Length != manifestLength ||
                    !Same(Sha(metadata), manifestHash))
                    throw new InvalidDataException("SETUP_MANIFEST_HASH_INVALID");

                var json = new JavaScriptSerializer { MaxJsonLength = MaxManifestSize };
                var manifest = json.DeserializeObject(new UTF8Encoding(false, true).GetString(metadata))
                    as IDictionary<string, object>;
                if (manifest == null || StringValue(manifest, "schema") != Schema)
                    throw new InvalidDataException("SETUP_MANIFEST_SCHEMA_INVALID");
                var product = ObjectValue(manifest, "product");
                if (StringValue(product, "schema") != ProductSchema)
                    throw new InvalidDataException("SETUP_PRODUCT_SCHEMA_INVALID");

                var info = new BundleInfo {
                    Id = StringValue(product, "id"),
                    Name = StringValue(product, "display_name"),
                    Publisher = StringValue(product, "publisher"),
                    Version = StringValue(product, "version"),
                    Architecture = StringValue(product, "architecture"),
                    Entrypoint = SafePath(StringValue(product, "entrypoint")),
                    InstallDir = SafePath(StringValue(product, "install_dir")),
                    PackageSha256 = Hex(zipHash),
                };
                if (!Regex.IsMatch(info.Id, @"\A[a-z][a-z0-9.-]{2,63}\z") ||
                    !Regex.IsMatch(info.Version, @"\A\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?\z") ||
                    (info.Architecture != "windows-x64" && info.Architecture != "windows-arm64") ||
                    info.Name.Length > 80 || info.Publisher.Length > 80)
                    throw new InvalidDataException("SETUP_PRODUCT_IDENTITY_INVALID");
                if (info.InstallDir.IndexOf('/') >= 0)
                    throw new InvalidDataException("SETUP_INSTALL_DIR_MUST_BE_SIMPLE");
                var req = manifest.ContainsKey("requirements") ? manifest["requirements"] : product["requirements"];
                if (!(req is IList))
                    throw new InvalidDataException("SETUP_REQUIREMENTS_INVALID");
                foreach (object element in (IList)req)
                {
                    if (!(element is string) || (string)element != "webview2-evergreen")
                        throw new InvalidDataException("SETUP_REQUIREMENTS_INVALID");
                    info.NeedsWebView2 = true;
                }

                var provenance = ObjectValue(manifest, "source");
                info.SourceCommit = StringValue(provenance, "commit");
                if (!Regex.IsMatch(info.SourceCommit, @"\A[0-9a-f]{40}\z") ||
                    !Regex.IsMatch(StringValue(provenance, "tree"), @"\A[0-9a-f]{40}\z"))
                    throw new InvalidDataException("SETUP_SOURCE_IDENTITY_INVALID");
                var files = manifest["files"] as IList;
                if (files == null || files.Count == 0 || files.Count > MaxFiles)
                    throw new InvalidDataException("SETUP_FILES_INVALID");
                var expected = new Dictionary<string, Expected>(StringComparer.OrdinalIgnoreCase);
                long total = 0;
                foreach (object row in files)
                {
                    var item = row as IDictionary<string, object>;
                    if (item == null) throw new InvalidDataException("SETUP_FILES_INVALID");
                    var f = new Expected {
                        Path = SafePath(StringValue(item, "path")),
                        Sha = StringValue(item, "sha256")
                    };
                    try { f.Bytes = Convert.ToInt64(item["bytes"], CultureInfo.InvariantCulture); }
                    catch { throw new InvalidDataException("SETUP_FILE_LENGTH_INVALID"); }
                    if (f.Bytes < 0 || f.Bytes > MaxFile ||
                        !Regex.IsMatch(f.Sha, @"\A[0-9a-f]{64}\z") ||
                        expected.ContainsKey(f.Path))
                        throw new InvalidDataException("SETUP_FILE_IDENTITY_INVALID");
                    total += f.Bytes;
                    if (total > MaxTotal)
                        throw new InvalidDataException("SETUP_EXTRACTED_SIZE_EXCEEDED");
                    expected.Add(f.Path, f);
                }
                if (!expected.ContainsKey(info.Entrypoint))
                    throw new InvalidDataException("SETUP_ENTRYPOINT_MISSING");
                info.PayloadBytes = total;

                // A segment stream lets ZipArchive inspect only the authenticated
                // ZIP region without copying a potentially multi-GB archive to TEMP.
                using (var zipRegion = new RegionStream(source, stubLength, zipLength))
                using (var zip = new ZipArchive(zipRegion, ZipArchiveMode.Read, true))
                {
                    if (zip.Entries.Count != expected.Count)
                        throw new InvalidDataException("SETUP_ZIP_FILE_COUNT_INVALID");
                    var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    foreach (var entry in zip.Entries)
                    {
                        string relative = SafePath(entry.FullName);
                        if (entry.Name.Length == 0 || !visited.Add(relative) ||
                            !expected.ContainsKey(relative))
                            throw new InvalidDataException("SETUP_ZIP_ENTRY_UNKNOWN");
                        if (((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000)
                            throw new InvalidDataException("SETUP_ZIP_LINK_FORBIDDEN");
                        Expected file = expected[relative];
                        if (entry.Length != file.Bytes)
                            throw new InvalidDataException("SETUP_ZIP_ENTRY_LENGTH_INVALID");
                        // Stage only inside an empty caller-owned directory.
                        // Extraction is the exact same bounded verification loop
                        // used by pure inspection; no unverified files activate.
                        string targetFile = null;
                        if (stagingRoot != null)
                        {
                            string prefix = Path.GetFullPath(stagingRoot)
                                .TrimEnd(Path.DirectorySeparatorChar) +
                                Path.DirectorySeparatorChar;
                            targetFile = Path.GetFullPath(Path.Combine(prefix,
                                relative.Replace('/', Path.DirectorySeparatorChar)));
                            if (!targetFile.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                                throw new InvalidDataException("SETUP_STAGING_ESCAPE");
                            Directory.CreateDirectory(Path.GetDirectoryName(targetFile));
                        }
                        long readLength = 0;
                        byte[] buffer = new byte[BufferSize];
                        using (var stream = entry.Open())
                        using (var hash = SHA256.Create())
                        using (var dest = targetFile == null ? null :
                            new FileStream(targetFile, FileMode.CreateNew,
                                FileAccess.Write, FileShare.None))
                        {
                            int n;
                            while ((n = stream.Read(buffer, 0, buffer.Length)) != 0)
                            {
                                readLength += n;
                                if (readLength > file.Bytes)
                                    throw new InvalidDataException("SETUP_ZIP_ENTRY_EXPANSION");
                                if (dest != null) dest.Write(buffer, 0, n);
                                hash.TransformBlock(buffer, 0, n, buffer, 0);
                            }
                            hash.TransformFinalBlock(new byte[0], 0, 0);
                            if (readLength != file.Bytes || Hex(hash.Hash) != file.Sha)
                                throw new InvalidDataException("SETUP_ZIP_ENTRY_HASH_INVALID");
                            if (dest != null) dest.Flush(true);
                        }
                    }
                }
                info.FileCount = expected.Count;
                return info;
            }
        }

        internal static string SafePath(string value)
        {
            if (String.IsNullOrEmpty(value) || value.Length > 512 ||
                value[0] == '/' || value.IndexOf('\\') >= 0 ||
                value.Contains("//"))
                throw new InvalidDataException("SETUP_RELATIVE_PATH_INVALID");
            string[] parts = value.Split('/');
            foreach (string name in parts)
            {
                if (name == "" || name == "." || name == ".." ||
                    name.EndsWith(".") || name.EndsWith(" "))
                    throw new InvalidDataException("SETUP_RELATIVE_PATH_INVALID");
                string prefix = name.Split('.')[0].ToUpperInvariant();
                if (prefix == "CON" || prefix == "PRN" || prefix == "AUX" || prefix == "NUL" ||
                    Regex.IsMatch(prefix, @"\A(?:COM|LPT)[1-9]\z"))
                    throw new InvalidDataException("SETUP_RELATIVE_PATH_INVALID");
                foreach (char c in name)
                    if (c < 32 || "<>:\"|?*".IndexOf(c) >= 0)
                        throw new InvalidDataException("SETUP_RELATIVE_PATH_INVALID");
            }
            return value;
        }

        private static IDictionary<string, object> ObjectValue(
            IDictionary<string, object> value, string key)
        {
            object element;
            if (!value.TryGetValue(key, out element) ||
                !(element is IDictionary<string, object>))
                throw new InvalidDataException("SETUP_OBJECT_INVALID_" + key);
            return (IDictionary<string, object>)element;
        }

        private static string StringValue(IDictionary<string, object> value, string key)
        {
            object element;
            if (!value.TryGetValue(key, out element) || !(element is string) ||
                String.IsNullOrEmpty((string)element))
                throw new InvalidDataException("SETUP_STRING_INVALID_" + key);
            return (string)element;
        }

        private static long Size(ulong value, string error)
        {
            if (value > long.MaxValue) throw new InvalidDataException(error);
            return (long)value;
        }

        private static bool Same(byte[] a, byte[] b)
        {
            if (a == null || b == null || a.Length != b.Length) return false;
            int different = 0;
            for (int i = 0; i < a.Length; i++) different |= a[i] ^ b[i];
            return different == 0;
        }

        private static byte[] Sha(byte[] bytes)
        {
            using (var hasher = SHA256.Create()) return hasher.ComputeHash(bytes);
        }

        private static string Hex(byte[] bytes)
        {
            var builder = new StringBuilder(bytes.Length * 2);
            foreach (byte value in bytes)
                builder.Append(value.ToString("x2", CultureInfo.InvariantCulture));
            return builder.ToString();
        }

        private static byte[] HashRegion(FileStream stream, long start, long length)
        {
            stream.Position = start;
            byte[] buffer = new byte[BufferSize];
            using (var sha = SHA256.Create())
            {
                while (length > 0)
                {
                    int read = stream.Read(buffer, 0, (int)Math.Min(length, buffer.Length));
                    if (read <= 0) throw new InvalidDataException("SETUP_REGION_TRUNCATED");
                    sha.TransformBlock(buffer, 0, read, buffer, 0);
                    length -= read;
                }
                sha.TransformFinalBlock(new byte[0], 0, 0);
                return sha.Hash;
            }
        }

        private sealed class RegionStream : Stream
        {
            private readonly FileStream source;
            private readonly long start, length;
            private long position;
            internal RegionStream(FileStream source, long start, long length)
            {
                this.source = source;
                this.start = start;
                this.length = length;
            }
            public override bool CanRead { get { return true; } }
            public override bool CanSeek { get { return true; } }
            public override bool CanWrite { get { return false; } }
            public override long Length { get { return length; } }
            public override long Position {
                get { return position; }
                set { Seek(value, SeekOrigin.Begin); }
            }
            public override int Read(byte[] buffer, int offset, int count)
            {
                if (count < 0 || offset < 0 || offset > buffer.Length - count)
                    throw new ArgumentOutOfRangeException();
                if (position >= length) return 0;
                int available = (int)Math.Min((long)count, length - position);
                source.Position = start + position;
                int amount = source.Read(buffer, offset, available);
                position += amount;
                return amount;
            }
            public override long Seek(long offset, SeekOrigin origin)
            {
                long target = origin == SeekOrigin.Begin ? offset :
                    origin == SeekOrigin.Current ? position + offset : length + offset;
                if (target < 0 || target > length)
                    throw new IOException("SETUP_ZIP_REGION_OUT_OF_BOUNDS");
                position = target;
                return position;
            }
            public override void Flush() { }
            public override void SetLength(long value) { throw new NotSupportedException(); }
            public override void Write(byte[] buffer, int offset, int count)
            { throw new NotSupportedException(); }
        }
    }
}

"""Read-only access diagnosis, status codes only. No source is downloaded."""
import os
import sys
import base64
import http.client

token = os.environ.pop("IWXA_TEMP_READ_TOKEN", "")
if not token:
    print("PRIVATE_ACCESS=TOKEN_UNAVAILABLE")
    sys.exit(1)
def status(host, path, auth):
    conn = http.client.HTTPSConnection(host, timeout=30)
    try:
        conn.request("GET", path, headers={"Authorization": auth,
                    "User-Agent":"IWXA-Private-Read-Preflight",
                    "Accept":"application/vnd.github+json"})
        response = conn.getresponse()
        return response.status
    except (OSError,http.client.HTTPException):
        return "CONNECTION_ERROR"
    finally:
        conn.close()
repo = status("api.github.com", "/repos/Faust-S/iwxa", "Bearer "+token)
commit = status("api.github.com", "/repos/Faust-S/iwxa/commits/3984cc4fe5e247fc8b9d876e13e6d83909e201c1", "Bearer "+token)
basic = "Basic "+base64.b64encode(("x-access-token:"+token).encode()).decode()
smart = status("github.com", "/Faust-S/iwxa.git/info/refs?service=git-upload-pack", basic)
print("PRIVATE_REPOSITORY_HTTP="+str(repo))
print("PRIVATE_COMMIT_HTTP="+str(commit))
print("PRIVATE_GIT_HTTP="+str(smart))
sys.exit(0 if (repo,commit,smart)==(200,200,200) else 1)

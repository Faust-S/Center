"""Bounded public summaries of the private executable-bundle probe."""
import re

REQUIRED = {
    'B066_BUNDLE_MATERIALIZE': 'PASS',
    'B066_BUNDLE_NODE_VERSION': 'PASS',
    'B066_BUNDLE_MCP_INITIALIZE': 'PASS',
    'B066_BUNDLE_MCP_PROTOCOL_CATALOG': 'PASS',
    'B066_BUNDLE_BROWSER_ACTIONS': 'NOT_RUN',
}
COUNT = 'B066_BUNDLE_MCP_TOOL_COUNT'
STAGE = 'B066_BUNDLE_STAGE'
CODE = 'B066_BUNDLE_CODE'
STAGES = {'MATERIALIZE', 'NODE_VERSION', 'MCP_INITIALIZE', 'MCP_CATALOG'}
CODES = {
    'MCP_CATALOG_INVALID', 'MCP_REQUIRED_TOOLS_MISSING', 'MCP_SCHEMA_INVALID',
    'MCP_ROUTING_SCHEMA_INVALID', 'MCP_LIST_PAGES_SCHEMA_INVALID', 'NODE_EXECUTABLE_VERSION',
    'mcp_stdio_server_identity_mismatch', 'mcp_stdio_tools_not_advertised',
    'mcp_stdio_not_negotiated', 'mcp_stdio_deadline', 'invalid_mcp_tools_list',
    'mcp_stdio_catalog_limit', 'mcp_stdio_invalid_catalog_cursor', 'mcp_stdio_catalog_page_limit',
    'duplicate_mcp_tool_name', 'stdio_unsupported_negotiation', 'stdio_eof',
    'stdio_invalid_or_overflow', 'stdio_invalid_envelope', 'stdio_message_too_large_or_unframed',
    'stdio_closed', 'stdio_timeout', 'stdio_timeout_before_send', 'stdio_send_failed',
    'stdio_response_id_mismatch', 'stdio_invalid_response', 'stdio_invalid_result', 'mcp_rpc_error',
    'browser_bundle_missing', 'browser_bundle_incomplete', 'browser_node_digest_mismatch',
    'browser_mcp_package_mismatch', 'browser_bundle_path_invalid', 'browser_bundle_case_collision',
    'browser_bundle_link_forbidden', 'browser_bundle_non_file',
    'browser_node_archive_invalid', 'browser_mcp_archive_path_invalid',
    'browser_mcp_archive_member_invalid', 'browser_mcp_archive_oversized',
    'OSError', 'FileNotFoundError', 'PermissionError', 'ValueError', 'RuntimeError',
    'TimeoutExpired', 'MCPToolError', 'StdioTransportError', 'JSONDecodeError',
    'BadZipFile', 'ReadError', 'ImportError', 'ModuleNotFoundError', 'UNCLASSIFIED',
}


def summarize(exit_code, output):
    evidence = {}
    invalid = False
    for line in output.splitlines():
        key, separator, value = line.partition('=')
        if not separator or not key.startswith('B066_BUNDLE_'):
            continue
        valid = ((key in REQUIRED and value == REQUIRED[key])
                 or (key == COUNT and re.fullmatch(r'[0-9]{1,3}', value) is not None and 8 <= int(value) <= 500)
                 or (key == STAGE and value in STAGES)
                 or (key == CODE and value in CODES))
        if not valid or key in evidence:
            invalid = True
            continue
        evidence[key] = value
    accepted = (exit_code == 0 and not invalid
                and set(evidence) == set(REQUIRED) | {COUNT})
    return accepted, evidence

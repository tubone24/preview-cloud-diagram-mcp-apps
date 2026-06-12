# Deploy to AWS Lambda Function URL

Deploy the MCP server using AWS Lambda + Function URL. It is compatible with the same MCP endpoint as the Cloudflare Workers version and can be used directly from clients such as Claude.ai and Claude Code.

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 20 or later |
| npm | (bundled with Node) |
| Terraform | 1.5 or later |
| AWS CLI | Configured (`aws configure` done) |

> **Important:** `terraform apply` runs build commands (`npm ci` / `npm run build:ui` / `npm run build:lambda`) locally. Run apply from a build environment where Node.js and npm are available.

## Deployment Steps

```bash
# 1. Navigate to the terraform directory
cd terraform

# 2. Initialize providers and modules
terraform init

# 3. Preview changes
terraform plan

# 4. Deploy (automatically runs build → Lambda update)
terraform apply
```

When `terraform apply` is run, the null_resource automatically performs the following:

1. `npm ci` — install dependencies
2. `npm run build:ui` — generate `public/index.html` with Vite
3. `npm run build:lambda` — generate `dist/lambda/index.js` with esbuild and copy `public/index.html` to `dist/lambda/index.html`

No manual build is required.

## Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `region` | `ap-northeast-1` | AWS region to deploy to |
| `function_name` | `preview-cloud-diagram-mcp` | Lambda function name |
| `memory_size` | `512` | Memory size (MB) |
| `timeout` | `30` | Timeout (seconds) |
| `log_retention_days` | `7` | CloudWatch Logs retention period (days) |

To override variables, use `terraform apply -var="function_name=my-mcp"` or create a `terraform.tfvars` file.

## Outputs

After `terraform apply` completes, the following values are output.

| Output | Description |
|--------|-------------|
| `function_url` | Lambda Function URL base URL (trailing `/`) |
| `mcp_endpoint` | MCP endpoint (`<function_url>mcp`) |

Accessing `GET <function_url>` at the root returns the architecture diagram UI HTML.

## Verify Connection

After deployment, verify the MCP handshake with the following command:

```bash
curl -X POST <mcp_endpoint> \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

Replace `<mcp_endpoint>` with the output value from `terraform apply` (e.g. `https://xxxx.lambda-url.ap-northeast-1.on.aws/mcp`).

## Register with MCP Clients

### Claude.ai (Custom Connector)

1. Open **Settings > Connectors**
2. Click **Add custom connector**
3. Enter the `mcp_endpoint` value as the URL (no authentication required)

### Claude Code (MCP Configuration)

```json
{
  "mcpServers": {
    "cloud-diagram": {
      "url": "<mcp_endpoint>"
    }
  }
}
```

After registering, ask about AWS / Azure / GCP configurations in chat and `render_diagram` will be called to display the diagram inline.

## Notes

- **Public without authentication:** The Function URL is public with no authentication (`NONE`). If the URL is leaked, third parties can use it without restriction. When no longer needed, delete with `terraform destroy` or disable the function in the Lambda console.
- **Response size limit:** Lambda's payload limit is 6 MB. Since the UI HTML is approximately 3 MB, the effective response size limit is approximately 3 MB.
- **Stateless only:** Lambda does not maintain state across requests. Use cases requiring session state are not supported.

## Cleanup

```bash
cd terraform
terraform destroy
```

All AWS resources (Lambda function, IAM role, CloudWatch Logs group, Function URL) will be deleted.

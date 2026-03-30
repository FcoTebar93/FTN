export const SWAGGER_UI_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FTN API — Swagger UI</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.11.0/swagger-ui.min.css" crossorigin="anonymous" />
  <style>body { margin: 0; }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin="anonymous"></script>
  <script>
    window.onload = function () {
      SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        filter: true,
        tryItOutEnabled: true
      });
    };
  </script>
</body>
</html>`;

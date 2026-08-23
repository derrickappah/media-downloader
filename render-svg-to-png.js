const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const svgPath = path.join(__dirname, 'icons', 'icon.svg');
if (!fs.existsSync(svgPath)) {
  console.error('icon.svg does not exist at', svgPath);
  process.exit(1);
}

const svgContent = fs.readFileSync(svgPath, 'utf8');

const htmlContent = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<script>
const svgStr = ${JSON.stringify(svgContent)};
const blob = new Blob([svgStr], { type: 'image/svg+xml' });
const url = URL.createObjectURL(blob);
const img = new Image();

img.onload = async () => {
  const sizes = [16, 32, 48, 128];
  const results = {};

  for (const size of sizes) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size);
    results[size] = canvas.toDataURL('image/png').split(',')[1];
  }

  const resultDiv = document.createElement('div');
  resultDiv.id = 'output';
  resultDiv.textContent = JSON.stringify(results);
  document.body.appendChild(resultDiv);
};

img.src = url;
</script>
</body>
</html>`;

const tempHtmlPath = path.join(__dirname, 'temp_render.html');
fs.writeFileSync(tempHtmlPath, htmlContent);

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

try {
  const command = `"${chromePath}" --headless=new --disable-gpu --dump-dom "file:///${tempHtmlPath.replace(/\\\\/g, '/')}"`;
  const output = execSync(command, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

  const match = output.match(/<div id="output">([\s\S]*?)<\/div>/);
  if (match && match[1]) {
    const data = JSON.parse(match[1]);
    for (const size of [16, 32, 48, 128]) {
      if (data[size]) {
        const buf = Buffer.from(data[size], 'base64');
        const outPath = path.join(__dirname, 'icons', `icon${size}.png`);
        fs.writeFileSync(outPath, buf);
        console.log(`Generated icon${size}.png (${size}x${size}, ${buf.length} bytes)`);
      }
    }
  } else {
    console.error('Could not extract output div from Chrome dump');
  }
} catch (err) {
  console.error('Error running Chrome headless:', err.message);
} finally {
  if (fs.existsSync(tempHtmlPath)) {
    fs.unlinkSync(tempHtmlPath);
  }
}

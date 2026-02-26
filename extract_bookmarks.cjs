const fs = require('fs');
const html = fs.readFileSync('Startseite - OPAL mit offenen settings.htm', 'utf8');
const p1 = html.indexOf('data-portlet-order=\"Bookmarks\"');
if (p1 > -1) {
    const snippet = html.substring(p1, p1 + 5000);
    fs.writeFileSync('temp.html', snippet);
} else {
    console.log('Bookmarks not found');
}

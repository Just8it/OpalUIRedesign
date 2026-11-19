import assert from 'node:assert/strict';
import test from 'node:test';
import { folderClickUrls, parseFolder } from '../src/course/parsers.ts';

const NODE = 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/1001/CourseNode/2002';
const LISTENER = '-fluidContainer-rowContainer-tableForm-contentContainer-tableContainer-multiSelect-multiSelectGroup';

/** Markup modelled on a live OPAL folder page: rows plus the Wicket listeners bound to their links. */
function folderPage({ upload = false } = {}) {
    return `
    <p>${upload ? 'Sie dürfen Dateien hochladen.' : 'Sie dürfen Dateien herunterladen.'}</p>
    <table><tbody>
      <tr><td><span class="fonticon icon-folder" title="Ordner"></span></td>
          <td><a id="idA1" href="${NODE}/Kapitel+1+-+Grundlagen" data-file-name="Kapitel 1 - Grundlagen"><span>Kapitel 1 - Grundlagen</span></a></td>
          <td></td><td><span>am 12.10.2026 um 16:49 Uhr</span></td></tr>
      <tr><td><span class="fonticon icon-pdf"></span></td>
          <td><a id="idA2" href="${NODE}/Transaction_Notes.pdf" data-file-name="Transaction_Notes.pdf"><span>Transaction_Notes.pdf</span></a></td>
          <td>1,2 MB</td><td><span>am 03.11.2026 um 09:15 Uhr</span></td></tr>
    </tbody></table>
    <script>
    (function() {var callback = function (callback) {
    var attrs = {"u":"/opal/auth/RepositoryEntry/1001/CourseNode/2002?7-1.0${LISTENER}-tableRow-1-tableCellRepeating-2-tableLink","c":"idA1","dt":"html"};
    Wicket.Ajax.ajax(attrs);}})();
    Wicket.Ajax.ajax({"u":"/opal/auth/RepositoryEntry/1001/CourseNode/2002?7-1.1${LISTENER}-tableRow-1-tableCellRepeating-2-tableLink","c":"idA1","i":"veil"});
    Wicket.Ajax.ajax({"u":"/opal/auth/RepositoryEntry/1001/CourseNode/2002?7-1.1${LISTENER}-deleteButton","c":"idDel"});
    Wicket.Ajax.ajax({"u":"/opal/auth/RepositoryEntry/9999/CourseNode/2002?7-1.1${LISTENER}-tableRow-1-tableCellRepeating-2-tableLink","c":"idOther"});
    Wicket.Ajax.ajax({"u":"https://evil.example/opal/auth/RepositoryEntry/1001/CourseNode/2002?7-1.1${LISTENER}-tableRow-1-tableCellRepeating-2-tableLink","c":"idEvil"});
    </script>`;
}

test('only the row link listener of this node is accepted as a folder click', () => {
    const clicks = folderClickUrls(folderPage(), NODE);
    assert.deepEqual([...clicks.keys()], ['idA1']);
    assert.match(clicks.get('idA1'), /\?7-1\.1-.*-tableRow-1-.*-tableLink$/);
});

test('folder rows carry their click url, files keep size and date', () => {
    const parsed = parseFolder(folderPage(), NODE);
    assert.equal(parsed.folders.length, 1);
    assert.equal(parsed.folders[0].title, 'Kapitel 1 - Grundlagen');
    assert.ok(parsed.folders[0].clickUrl);
    // "Transaction" contains "action": a file must never be dropped for its name.
    assert.equal(parsed.entries.length, 1);
    assert.equal(parsed.entries[0].title, 'Transaction_Notes.pdf');
    assert.equal(parsed.entries[0].sizeText, '1,2 MB');
    assert.equal(new Date(parsed.entries[0].modified).getFullYear(), 2026);
    assert.equal(parsed.canUpload, false);
});

test('files of an opened subfolder are listed under the node, with their folder path', () => {
    // What the click listener answers: an ajax response whose markup lists the subfolder.
    const response = `<?xml version="1.0" encoding="UTF-8"?><ajax-response><component id="idX"><![CDATA[
      <table><tbody><tr><td><span class="fonticon icon-pdf"></span></td>
        <td><a id="idB1" href="${NODE}/Kapitel%201%20-%20Grundlagen/Folien_01.pdf" data-file-name="Folien_01.pdf"><span>Folien_01.pdf</span></a></td>
        <td>640,5 KB</td><td><span>am 20.10.2026 um 08:00 Uhr</span></td></tr></tbody></table>]]></component></ajax-response>`;
    const parsed = parseFolder(response, NODE, ['Kapitel 1 - Grundlagen']);
    assert.equal(parsed.entries.length, 1);
    assert.deepEqual(parsed.entries[0].folderPath, ['Kapitel 1 - Grundlagen']);
    assert.match(parsed.entries[0].url, /Kapitel%201%20-%20Grundlagen\/Folien_01\.pdf$/);
});

test('hand-in folders are recognised', () => {
    assert.equal(parseFolder(folderPage({ upload: true }), NODE).canUpload, true);
});

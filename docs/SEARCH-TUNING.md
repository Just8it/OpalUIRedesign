# Search improvements and real-data checks

## Implemented

- Default command search excludes catalogue nodes before scoring and limiting. Previously, 30 catalogue hits could leave no visible local results after the interface filtered them out.
- Opening a course searches only that course's files before limiting results. Previously, other courses' files and matching folders could occupy all 20 candidate slots.
- Typo matching avoids combined token-array allocations and skips checks that cannot improve the current token score. Match weights remain unchanged.
- Compact sheet filenames such as `aero1_A03.pdf` and `aero1_L03.pdf` now resolve to sheet 3, including when loading an existing index. Verified against the supplied 898-node export.
- Dashboard indexing and the stored favorites snapshot now use bookmarks only. Calendar preloading checks favorite course IDs before crawling; enrolled courses remain available for calendar matching but do not become preload targets automatically. The separately enabled public catalogue and pages you explicitly visit remain independent sources. Existing stored entries are retained.

## Best next improvements

1. **Build a relevance set from real searches.** Supply 10–20 queries with the intended course/file, including typos and cases that fail today. Measure expected results in the first five hits before changing weights.
2. **Check index coverage and ancestry.** Missing files, wrong course IDs, or broken folder parents cannot be fixed by better ranking. Compare the exported index with one course's actual materials.
3. **Handle conversational requests.** Test phrases such as “find the solution for exercise 3 in TM2”. The parser currently treats filler words as search terms. Recognize these patterns without removing words that belong to course names.
4. **Explain fallback matches.** When there is no full match, the engine returns partial matches, including incorrect exercise numbers. Label these clearly so “Übung 3” does not look like an exact match for sheet 13.
5. **Audit duplicate identity.** Ranking currently removes every URL query parameter when deduplicating. Verify real stored links before deciding which parameters are safe to ignore; some can identify different destinations.
6. **Consider document-content search after coverage is reliable.** The current engine searches titles, paths, author and description, not downloaded PDF contents. Searching concepts inside PDFs needs a separate extraction/indexing feature.

These are proposals, not changes included in this pass. No new service or AI dependency is required for the first five.

## Export the data already stored in your browser

The repository does not contain your live browser index. The normal settings export also excludes it.

1. Open OPAL Redesign's extension **options/settings page**.
2. Under **Suche**, click **Suchindex exportieren**. This downloads `opal-redesign-search-index-YYYY-MM-DD.json` with the complete stored index. It does not change the index or include your other extension settings.
3. Review it before sharing: it includes course/file names, URLs, metadata and visit history. You can remove `lastVisited`, `visitCount`, `author` and `description`; keep relationships (`id`, `courseId`, `parentId`) consistent if anonymizing them. Remove any URL tokens or credentials.
4. Supply the JSON together with examples like:

```text
Query: tm2 lösung 3
Expected: Technische Mechanik 2 > Übungen > Lösung_03.pdf
Actual: no result / wrong course / wrong sheet
```

One representative course and five failing queries are enough to start. PDF files and account access are not needed for this first relevance pass.

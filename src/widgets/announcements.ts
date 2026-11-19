import { scrapePortlet } from './news-scraper';
export function scrapeAnnouncements() {
    // The former announcements widget aggregated these same two native feeds.
    return ['InfoMessages', 'Information'].flatMap(order => {
        const portlet = document.querySelector(`div[data-portlet-order="${order}"] section.panel.portlet`);
        return portlet ? scrapePortlet(portlet, 'announcements') : [];
    });
}

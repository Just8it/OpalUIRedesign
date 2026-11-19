import { scrapePortlet } from './news-scraper';
export function scrapeAktuelles() {
    const portlet = document.querySelector('div[data-portlet-order="Information"] section.panel.portlet');
    return portlet ? scrapePortlet(portlet, 'info') : [];
}

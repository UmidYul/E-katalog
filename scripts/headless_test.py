from playwright.sync_api import sync_playwright


def safe(page, q):
    try:
        return page.query_selector(q)
    except Exception:
        return None


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844})
        page = context.new_page()
        # Use host.docker.internal to reach host's nginx
        page.goto('http://host.docker.internal', timeout=30000)
        page.wait_for_timeout(1500)
        results = {}

        # Attempt to open mobile menu
        menu = safe(page, 'button[aria-label="Открыть меню"]') or safe(page, 'button[aria-label="Open menu"]')
        if menu:
            menu.click()
            page.wait_for_timeout(500)
            results['menu_open'] = bool(page.query_selector('.fixed.z-50'))
        else:
            results['menu_open'] = 'menu button not found'

        # Navigate to catalog and open filters
        try:
            page.goto('http://host.docker.internal/catalog', timeout=30000)
            page.wait_for_timeout(1000)
            filters = safe(page, 'button:has-text("Фильтры")') or safe(page, 'button:has-text("Filters")')
            if filters:
                filters.click()
                page.wait_for_timeout(500)
                sheets = page.query_selector_all('.fixed.z-50')
                results['sheets_count_after_filters'] = len(sheets)
                results['both_open'] = len(sheets) > 1
            else:
                results['filters_open'] = 'filters button not found'
        except Exception as e:
            results['catalog_error'] = str(e)

        print(results)
        browser.close()


if __name__ == '__main__':
    main()

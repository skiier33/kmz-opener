"""Temporary browser check for the node hover balloon. Deleted after the run."""
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/"
SAMPLE = r"c:\Users\AlexKruglick\Documents\Projects\kmz_opener\examples\sample.kml"


def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.goto(URL, wait_until="networkidle")
        page.set_input_files("#file-input", SAMPLE)
        page.wait_for_selector(".layer-row")
        page.wait_for_timeout(400)

        def row(name):
            return page.locator(".layer-row", has_text=name).first

        def balloon():
            return page.locator("#node-hover-balloon")

        row("Civic Center Park").hover()
        page.wait_for_selector("#node-hover-balloon:not(.hidden)")
        assert balloon().locator(".node-hover-name").inner_text() == "Civic Center Park"
        assert balloon().locator('button[title="Show"]').is_disabled()
        assert not balloon().locator('button[title="Hide"]').is_disabled()
        assert balloon().locator(".node-balloon-delete").is_enabled()

        balloon().locator('button[title="Hide"]').click()
        park_box = row("Civic Center Park").locator('input[type="checkbox"]')
        assert park_box.is_checked() is False
        assert balloon().locator('button[title="Show"]').is_enabled()
        assert balloon().locator('button[title="Hide"]').is_disabled()

        balloon().locator('button[title="Show"]').click()
        assert park_box.is_checked() is True
        assert balloon().locator('button[title="Hide"]').is_enabled()

        row("Points").hover()
        page.wait_for_function(
            "() => document.querySelector('#node-hover-balloon .node-hover-name')?.textContent === 'Points'"
        )
        balloon().locator('button[title="Hide"]').click()
        assert row("Civic Center Park").locator('input[type="checkbox"]').is_checked() is False
        assert row("Parks").locator('input[type="checkbox"]').is_checked() is False

        row("Sample Denver features").hover()
        page.wait_for_function(
            "() => document.querySelector('#node-hover-balloon .node-hover-name')?.textContent === 'Sample Denver features'"
        )
        assert balloon().locator(".node-balloon-delete").is_disabled()

        row("16th Street Mall").hover()
        page.wait_for_function(
            "() => document.querySelector('#node-hover-balloon .node-hover-name')?.textContent === '16th Street Mall'"
        )
        balloon().locator(".node-balloon-delete").click()
        page.wait_for_timeout(200)
        assert page.locator(".layer-row", has_text="16th Street Mall").count() == 0
        assert "Deleted 1 item" in page.locator("#status-message").inner_text()
        assert balloon().evaluate("el => el.classList.contains('hidden')")

        marker = page.locator(".leaflet-interactive").first
        marker.hover()
        page.wait_for_selector("#node-hover-balloon:not(.hidden)")
        map_name = balloon().locator(".node-hover-name").inner_text()
        assert map_name
        balloon().locator('button[title="Hide"]').click()
        hidden_row = row(map_name)
        assert hidden_row.locator('input[type="checkbox"]').is_checked() is False

        print("PASS", "map-hover=" + map_name)
        if errors:
            print("PAGEERRORS")
            for err in errors:
                print(err)
            raise SystemExit(1)
        browser.close()


if __name__ == "__main__":
    main()

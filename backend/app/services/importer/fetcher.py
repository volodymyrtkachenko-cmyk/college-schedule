import hashlib
import httpx
import logging
from typing import Tuple, List
from selectolax.parser import HTMLParser

logger = logging.getLogger(__name__)

class ScheduleFetcher:
    def __init__(self):
        self.base_url = "https://kre.dp.ua/rozklad-zanyat"
        self.headers = {
            "User-Agent": "KRE-Schedule-Fetcher/1.0 (+https://github.com/admin/college-schedule)"
        }
        self.last_main_page_hash: str | None = None

    async def fetch_html(self, client: httpx.AsyncClient, url: str) -> str:
        response = await client.get(url, headers=self.headers)
        response.raise_for_status()
        return response.text

    async def get_main_page_data(self) -> Tuple[str, str, List[str]]:
        """Завантажує головну сторінку розкладу коледжу та повертає (sha256_hash, html, group_ids)."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            html = await self.fetch_html(client, self.base_url)
            page_hash = hashlib.sha256(html.encode("utf-8")).hexdigest()
            self.last_main_page_hash = page_hash
            tree = HTMLParser(html)
            group_nodes = tree.css(".ktt-groups a")

            group_ids = []
            for g in group_nodes:
                group_id_str = g.attributes.get("data-item") or g.text(strip=True)
                if group_id_str and group_id_str not in group_ids:
                    group_ids.append(group_id_str)
            return page_hash, html, group_ids

    async def get_all_group_ids(self) -> List[str]:
        _, _, group_ids = await self.get_main_page_data()
        return group_ids

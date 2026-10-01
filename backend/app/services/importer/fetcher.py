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

    async def fetch_html(self, client: httpx.AsyncClient, url: str) -> str:
        response = await client.get(url, headers=self.headers)
        response.raise_for_status()
        return response.text

    async def get_all_group_ids(self) -> List[str]:
        async with httpx.AsyncClient(timeout=15.0) as client:
            html = await self.fetch_html(client, self.base_url)
            tree = HTMLParser(html)
            group_nodes = tree.css(".ktt-groups a")
            
            group_ids = []
            for g in group_nodes:
                group_id_str = g.attributes.get("data-item") or g.text(strip=True)
                if group_id_str and group_id_str not in group_ids:
                    group_ids.append(group_id_str)
            return group_ids

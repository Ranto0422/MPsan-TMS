import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer

class PropertyConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        user = self.scope.get('user')
        logging.debug('WS connect: user=%s scope_user=%s', user, type(user))
        self.property_id = self.scope['url_route']['kwargs'].get('pk')
        self.group_name = f'property_{self.property_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        logging.debug('WS disconnect: property=%s user=%s close_code=%s', getattr(self, 'property_id', None), self.scope.get('user'), close_code)
        try:
            await self.channel_layer.group_discard(self.group_name, self.channel_name)
        except Exception:
            pass

    async def layouts_update(self, event):
        # event expected to have 'layouts' key
        payload = {
            'type': 'layouts.update',
            'layouts': event.get('layouts'),
        }
        await self.send(text_data=json.dumps(payload))

    async def layout_status(self, event):
        # optional separate message type for single-room status updates
        payload = {
            'type': 'layout.status',
            'data': event.get('data'),
        }
        await self.send(text_data=json.dumps(payload))

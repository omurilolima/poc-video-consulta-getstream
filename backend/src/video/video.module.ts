import { Module } from '@nestjs/common';
import { VideoService } from './video.service';
import { VideoController } from './video.controller';
import { WebhookController } from './webhook.controller';

@Module({
  controllers: [VideoController, WebhookController],
  providers: [VideoService],
})
export class VideoModule {}

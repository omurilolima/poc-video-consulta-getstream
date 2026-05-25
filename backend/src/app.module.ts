import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { VideoModule } from './video/video.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // .env lives at the workspace root, one level above backend/
      envFilePath: '../.env',
    }),
    VideoModule,
  ],
})
export class AppModule {}

import {
  Controller,
  Post,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { VideoService } from './video.service';

interface GetStreamWebhookEvent {
  type: string;
  call?: {
    custom?: { sessionId?: string };
    id?: string;
  };
  call_cid?: string;
  user?: { id?: string };
  participant?: { user_id?: string };
  [key: string]: unknown;
}

@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly videoService: VideoService) {}

  /**
   * POST /webhooks/getstream
   * Recebe eventos do GetStream e dispara transições de estado na máquina.
   *
   * Eventos tratados:
   *   call.session_participant_joined → aguardando / midia_pendente
   *   call.session_participant_left   → midia_pendente (se estava ativa)
   *   call.session_ended              → encerrada
   */
  @Post('getstream')
  @HttpCode(HttpStatus.OK)
  handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-signature') signature: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) {
      this.logger.warn('Webhook received without raw body — skipping verification');
      return { ok: true };
    }

    const valid = this.videoService.verifyWebhookSignature(rawBody, signature ?? '');
    if (!valid) {
      this.logger.warn('Invalid webhook signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    let event: GetStreamWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString('utf8')) as GetStreamWebhookEvent;
    } catch {
      this.logger.warn('Could not parse webhook body');
      return { ok: true };
    }

    const sessionId = event.call?.custom?.sessionId;
    if (!sessionId) {
      this.logger.debug(`Webhook event ${event.type} has no sessionId — ignoring`);
      return { ok: true };
    }

    const userId = event.participant?.user_id ?? event.user?.id;

    this.logger.log(`Webhook: ${event.type} | session=${sessionId} | user=${userId ?? 'n/a'}`);

    switch (event.type) {
      case 'call.session_participant_joined':
        if (userId) this.videoService.onParticipantJoined(sessionId, userId);
        break;

      case 'call.session_participant_left':
        if (userId) this.videoService.onParticipantLeft(sessionId, userId);
        break;

      case 'call.session_ended':
      case 'call.ended':
        this.videoService.onSessionEnded(sessionId);
        break;

      default:
        this.logger.debug(`Unhandled webhook event type: ${event.type}`);
    }

    return { ok: true };
  }
}

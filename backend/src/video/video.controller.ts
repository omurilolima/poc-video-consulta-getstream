import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VideoService } from './video.service';
import { ParticipantRole } from './session.entity';

@Controller('sessions')
export class VideoController {
  constructor(
    private readonly videoService: VideoService,
    private readonly config: ConfigService,
  ) {}

  /**
   * POST /sessions
   * Cria uma nova sessão de videoconsulta e a call correspondente no GetStream.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createSession() {
    const result = await this.videoService.createSession();
    return result;
  }

  /**
   * GET /sessions/:id
   * Retorna o estado atual da sessão (usado para polling pelo cliente).
   */
  @Get(':id')
  getSession(@Param('id') id: string) {
    const session = this.videoService.getSession(id);
    return this.videoService.serializeSession(session);
  }

  /**
   * GET /sessions/:id/token?userId=X&role=paciente|medico
   * Emite um token GetStream para o participante entrar na call.
   * Retorna 403 se sessão vetada e role=paciente.
   */
  @Get(':id/token')
  async getToken(
    @Param('id') id: string,
    @Query('userId') userId: string,
    @Query('role') role: string,
  ) {
    if (!userId) throw new BadRequestException('userId is required');
    if (role !== 'paciente' && role !== 'medico') {
      throw new BadRequestException('role must be "paciente" or "medico"');
    }

    const session = this.videoService.getSession(id);
    const token = await this.videoService.generateToken(id, userId, role as ParticipantRole);

    return {
      token,
      callId: session.callId,
      callType: session.callType,
      apiKey: this.config.getOrThrow<string>('getstream_api_key'),
    };
  }

  /**
   * POST /sessions/:id/joined?userId=X
   * Sinal do cliente após entrar na call GetStream (substitui webhook na PoC).
   */
  @Post(':id/joined')
  @HttpCode(HttpStatus.OK)
  notifyJoined(@Param('id') id: string, @Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId is required');
    this.videoService.onParticipantJoined(id, userId);
    const session = this.videoService.getSession(id);
    return this.videoService.serializeSession(session);
  }

  /**
   * POST /sessions/:id/left?userId=X
   * Sinal do cliente após sair da call (substitui webhook na PoC — C3).
   */
  @Post(':id/left')
  @HttpCode(HttpStatus.OK)
  notifyLeft(@Param('id') id: string, @Query('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId is required');
    this.videoService.onParticipantLeft(id, userId);
    const session = this.videoService.getSession(id);
    return this.videoService.serializeSession(session);
  }

  /**
   * POST /sessions/:id/media-ready?userId=X
   * Sinal do cliente de que o stream do outro participante está sendo recebido.
   * Backend transita para `ativa` quando ambos os participantes sinalizarem.
   */
  @Post(':id/media-ready')
  @HttpCode(HttpStatus.OK)
  signalMediaReady(
    @Param('id') id: string,
    @Query('userId') userId: string,
  ) {
    if (!userId) throw new BadRequestException('userId is required');
    return this.videoService.signalMediaReady(id, userId);
  }

  /**
   * POST /sessions/:id/end?veto=true|false
   * Encerra a sessão. Se veto=true, bloqueia reentrada do paciente (C4).
   */
  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  async endSession(
    @Param('id') id: string,
    @Query('veto') veto: string,
  ) {
    const session = await this.videoService.endSession(id, veto === 'true');
    return this.videoService.serializeSession(session);
  }
}

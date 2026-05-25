import {
  Directive,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import type { AudioTrackType, VideoTrackType } from '@stream-io/video-client';

type StreamCallBinding = {
  bindVideoElement(
    element: HTMLVideoElement,
    sessionId: string,
    trackType: VideoTrackType,
  ): (() => void) | undefined;
  bindAudioElement(
    element: HTMLAudioElement,
    sessionId: string,
    trackType?: AudioTrackType,
  ): (() => void) | undefined;
};

@Directive({
  selector: '[videoStream], video[streamVideoTrack], audio[streamAudioTrack]',
  standalone: true,
})
export class VideoStreamDirective implements OnChanges, OnDestroy {
  @Input() streamCall?: StreamCallBinding;
  @Input() participantSessionId?: string;
  @Input() streamTrackType: VideoTrackType | AudioTrackType = 'videoTrack';

  private unbind?: () => void;

  @Input() set videoStream(stream: MediaStream | undefined | null) {
    if (this.el.nativeElement.srcObject !== stream) {
      this.el.nativeElement.srcObject = stream ?? null;
      void this.el.nativeElement.play().catch(() => undefined);
    }
  }

  constructor(private el: ElementRef<HTMLMediaElement>) {}

  ngOnChanges(_changes: SimpleChanges): void {
    this.bindStreamElement();
  }

  ngOnDestroy(): void {
    this.unbind?.();
  }

  private bindStreamElement(): void {
    this.unbind?.();
    this.unbind = undefined;

    if (!this.streamCall || !this.participantSessionId) return;

    const element = this.el.nativeElement;
    if (element instanceof HTMLVideoElement) {
      this.unbind = this.streamCall.bindVideoElement(
        element,
        this.participantSessionId,
        this.streamTrackType as VideoTrackType,
      );
    } else if (element instanceof HTMLAudioElement) {
      this.unbind = this.streamCall.bindAudioElement(
        element,
        this.participantSessionId,
        this.streamTrackType as AudioTrackType,
      );
    }
  }
}

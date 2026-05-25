import { Directive, ElementRef, Input } from '@angular/core';

@Directive({
  selector: '[videoStream]',
  standalone: true,
})
export class VideoStreamDirective {
  @Input() set videoStream(stream: MediaStream | undefined | null) {
    if (this.el.nativeElement.srcObject !== stream) {
      this.el.nativeElement.srcObject = stream ?? null;
    }
  }

  constructor(private el: ElementRef<HTMLMediaElement>) {}
}

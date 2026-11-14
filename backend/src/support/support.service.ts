import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../email/email.service.js';
import { CreateSupportRequestDto } from './dto/create-support-request.dto.js';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);
  private readonly supportEmail = 'support@faroldeleiloes.com.br';

  constructor(private readonly emailService: EmailService) {}

  async submitSupportRequest(
    userId: string,
    userEmail: string,
    userName: string,
    dto: CreateSupportRequestDto,
  ): Promise<{ message: string }> {
    await this.emailService.sendSupportEmail(
      this.supportEmail,
      userEmail,
      userName,
      dto.title,
      dto.description,
    );

    // SC-15: neither the sender nor the title (user content) is logged.
    this.logger.log(`Support request submitted (title ${dto.title.length} chars)`);

    return { message: 'Solicitação de suporte enviada com sucesso.' };
  }
}

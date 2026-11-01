import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { CreateSupportRequestDto } from './dto/create-support-request.dto';

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

    this.logger.log(`Support request submitted by ${userEmail}: "${dto.title}"`);

    return { message: 'Solicitação de suporte enviada com sucesso.' };
  }
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SupportedLanguage } from '../../common/enums/language.enum';

export class CreateCodeSessionDto {
  @ApiProperty({ enum: SupportedLanguage })
  @IsEnum(SupportedLanguage)
  language!: SupportedLanguage;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  template_code?: string;
}

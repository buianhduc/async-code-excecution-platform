import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MaxLength } from 'class-validator';
import { SupportedLanguage } from '../../common/enums/language.enum';

export class UpdateCodeSessionDto {
  @ApiProperty({ enum: SupportedLanguage })
  @IsEnum(SupportedLanguage)
  language!: SupportedLanguage;

  @ApiProperty()
  @IsString()
  @MaxLength(50_000)
  source_code!: string;
}

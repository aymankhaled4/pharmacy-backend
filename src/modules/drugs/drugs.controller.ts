import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DrugsService } from './drugs.service';

@ApiTags('Drugs')
@Controller('drugs')
export class DrugsController {
  constructor(private readonly drugsService: DrugsService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search drugs by brand, generic, or active ingredient' })
  @ApiQuery({ name: 'q', required: true })
  search(@Query('q') query: string) {
    return this.drugsService.search(query);
  }

  @Get('trending')
  @ApiOperation({ summary: 'List medicines for trending cards' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getTrending(@Query('limit') limit?: string) {
    return this.drugsService.getTrending(limit);
  }

  @Get('top-requested')
  @ApiOperation({ summary: 'List most requested medicines for analytics charts' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  getTopRequested(@Query('limit') limit?: string) {
    return this.drugsService.getTopRequested(limit);
  }

  @Get(':id/nearby')
  @ApiOperation({ summary: 'Find nearby approved pharmacies that have this drug in stock' })
  @ApiQuery({ name: 'lat', required: true, type: Number })
  @ApiQuery({ name: 'lng', required: true, type: Number })
  @ApiQuery({ name: 'radius', required: false, type: Number })
  findNearby(
    @Param('id') drugId: string,
    @Query('lat') latitude: string,
    @Query('lng') longitude: string,
    @Query('radius') radius?: string,
  ) {
    return this.drugsService.findNearby(drugId, latitude, longitude, radius);
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import type { AuthUser } from '../../common/types/auth-user.type';
import { AddInventoryItemDto } from './dto/add-inventory-item.dto';
import { InventoryFilterDto } from './dto/inventory-filter.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { InventoryService } from './inventory.service';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('pharmacy/inventory')
@UseGuards(SupabaseAuthGuard, RolesGuard)
@Roles('pharmacy')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'List current pharmacy inventory' })
  list(@CurrentUser() user: AuthUser, @Query() filters: InventoryFilterDto) {
    return this.inventoryService.list(user.id, filters);
  }

  @Get('near-expiry')
  @ApiOperation({ summary: 'List active inventory items expiring in the next 30 days' })
  getNearExpiry(@CurrentUser() user: AuthUser) {
    return this.inventoryService.getNearExpiry(user.id);
  }

  @Post()
  @ApiOperation({ summary: 'Add a new inventory item' })
  add(@CurrentUser() user: AuthUser, @Body() dto: AddInventoryItemDto) {
    return this.inventoryService.add(user.id, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an inventory item owned by current pharmacy' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateInventoryItemDto,
  ) {
    return this.inventoryService.update(id, user.id, dto);
  }

  @Patch(':id/discount')
  @ApiOperation({ summary: 'Update only the discount percent for an inventory item' })
  updateDiscount(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDiscountDto,
  ) {
    return this.inventoryService.updateDiscount(
      id,
      user.id,
      dto.discount_percent,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an inventory item owned by current pharmacy' })
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inventoryService.remove(id, user.id);
  }
}

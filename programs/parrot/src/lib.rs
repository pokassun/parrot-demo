#![feature(proc_macro_hygiene)]

use anchor_lang::prelude::*;
use anchor_spl::token::{self};

// Define the program's instruction handlers.

#[program]
mod parrot {

    use anchor_spl::token::{self, MintTo, Transfer};

    use super::*;

    pub fn init_debt_type(ctx: Context<InitDebtType>, nonce: u8) -> Result<()> {
        let account = &mut ctx.accounts.debt_type;
        account.debt_token = ctx.accounts.debt_token.key.clone();
        account.owner = ctx.accounts.owner.key.clone();
        account.nonce = nonce;
        Ok(())
    }

    pub fn init_vault_type(ctx: Context<InitVaultType>, nonce: u8) -> Result<()> {
        let account = &mut ctx.accounts.vault_type;
        account.nonce = nonce;
        account.debt_type = ctx.accounts.debt_type.to_account_info().key.clone();
        account.collateral_token = ctx
            .accounts
            .collateral_token_holder
            .to_account_info()
            .key
            .clone();
        account.collateral_token_holder = ctx
            .accounts
            .collateral_token_holder
            .to_account_info()
            .key
            .clone();
        Ok(())
    }

    pub fn init_vault(
        ctx: Context<InitVault>,
        debt_amount: u64,
        collateral_amount: u64,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.vault_type = ctx.accounts.vault_type.to_account_info().key.clone();
        vault.owner = ctx.accounts.owner.key.clone();
        vault.debt_amount = debt_amount;
        vault.collateral_amount = collateral_amount;
        Ok(())
    }

    pub fn stake(ctx: Context<Stake>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;

        // transfer collateral from user to vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.collateral_from.to_account_info(),
            to: ctx.accounts.collateral_to.to_account_info(),
            authority: ctx.accounts.collateral_from_authority.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.clone();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        token::transfer(cpi_ctx, amount)?;

        vault.collateral_amount = vault
            .collateral_amount
            .checked_add(amount)
            .ok_or(ParrotError::NumberOverflow)?;

        Ok(())
    }

    pub fn borrow(ctx: Context<Borrow>, amount: u64) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        let debt_type =  &ctx.accounts.debt_type;

        // transfer dept from debt minter to user
        let seeds = &[
            ctx.accounts.debt_type.to_account_info().key.as_ref(),
            &[debt_type.nonce],
        ];
        let signer = &[&seeds[..]];
        let cpi_accounts = MintTo {
            mint: ctx.accounts.debt_token.to_account_info().clone(),
            to: ctx.accounts.debt_to.to_account_info().clone(),
            authority: ctx.accounts.debt_minter.to_account_info().clone(),
        };
        let cpi_program = ctx.accounts.token_program.clone();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::mint_to(cpi_ctx, amount)?;

        vault.debt_amount = vault
            .debt_amount
            .checked_add(amount)
            .ok_or(ParrotError::NumberOverflow)?;

        Ok(())
    }
}

// Init Instructions

#[derive(Accounts)]
pub struct InitDebtType<'info> {
    #[account(init)]
    debt_type: ProgramAccount<'info, DebtType>,

    debt_token: AccountInfo<'info>,

    owner: AccountInfo<'info>,

    rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitVaultType<'info> {
    debt_type: ProgramAccount<'info, DebtType>,

    #[account(init)]
    vault_type: ProgramAccount<'info, VaultType>,

    #[account(signer, "&debt_type.owner == owner.key")]
    owner: AccountInfo<'info>,

    collateral_token: AccountInfo<'info>,

    collateral_token_holder: AccountInfo<'info>,

    rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account()]
    debt_type: ProgramAccount<'info, DebtType>,

    #[account(has_one=debt_type)] // self.vault.dept_type == debt_type
    vault_type: ProgramAccount<'info, VaultType>,

    #[account(init)]
    vault: ProgramAccount<'info, Vault>,

    owner: AccountInfo<'info>,

    rent: Sysvar<'info, Rent>,
}

// Workflow Instructions

#[derive(Accounts)]
pub struct Stake<'info> {
    vault_type: ProgramAccount<'info, VaultType>,

    #[account(mut, has_one=vault_type)]
    vault: ProgramAccount<'info, Vault>,

    #[account("token_program.key == &token::ID")]
    token_program: AccountInfo<'info>,

    #[account(mut)]
    collateral_from: AccountInfo<'info>,

    // #[account(signer)]
    collateral_from_authority: AccountInfo<'info>,

    #[account(mut, "&vault_type.collateral_token_holder == collateral_to.key")]
    collateral_to: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Borrow<'info> {
    debt_type: ProgramAccount<'info, DebtType>,

    vault_type: ProgramAccount<'info, VaultType>,

    #[account(mut, has_one=vault_type)]
    vault: ProgramAccount<'info, Vault>,

    #[account("token_program.key == &token::ID")]
    token_program: AccountInfo<'info>,

    #[account(mut, "&debt_type.debt_token == debt_token.key")]
    debt_token: AccountInfo<'info>,

    #[account(mut, "&debt_type.debt_token == debt_token.key")]
    debt_minter: AccountInfo<'info>,

    #[account(mut)]
    debt_to: AccountInfo<'info>, 

    // vault_owner: AccountInfo<'info>,
}

// Define the program owned accounts.

#[account]
pub struct DebtType {
    // dept token
    debt_token: Pubkey,
    // dept token owner
    owner: Pubkey,
    //
    nonce: u8,
}

#[account]
pub struct VaultType {
    // belongs to this debt type
    debt_type: Pubkey,
    // type of spl-token to accept as collateral
    collateral_token: Pubkey,
    // token account to hold the collaterals. A program account owns this token account.
    collateral_token_holder: Pubkey,
    //
    nonce: u8,
    // TODO: integrate CpiAccount
    // price_oracle: Pubkey,
}

#[account]
pub struct Vault {
    // belongs_to VaultType
    vault_type: Pubkey,
    // type of spl-token to accept as collateral
    owner: Pubkey,
    //
    debt_amount: u64,
    //
    collateral_amount: u64,
}

// Define errors

#[error]
pub enum ParrotError {
    #[msg("number overflow the u64")]
    NumberOverflow,
}

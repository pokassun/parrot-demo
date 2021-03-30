#![feature(proc_macro_hygiene)]

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, TokenAccount, Transfer};

// Define the program's instruction handlers.

#[program]
mod parrot {

    use anchor_spl::token::{self, Transfer};

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
        let account = &mut ctx.accounts.vault;
        account.vault_type = ctx.accounts.vault_type.to_account_info().key.clone();
        account.owner = ctx.accounts.owner.key.clone();
        account.debt_amount = debt_amount;
        account.collateral_amount = collateral_amount;
        Ok(())
    }

    pub fn init_stake(
        ctx: Context<InitStake>,
        amount: u64,
        collateral_holder_nonce: u8,
    ) -> Result<()> {
        let account = &mut ctx.accounts.stake;
        account.vault = ctx.accounts.vault.to_account_info().key.clone();

        // transfer from user token account to collateral holding account
        let seeds = &[
            ctx.accounts.collateral_from_authority.key.as_ref(),
            &[collateral_holder_nonce],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.collateral_from.to_account_info(),
            // TODO: can we access and use directly the vault_type.collateral_token_holder? so we don't need collateral_to
            to: ctx.accounts.collateral_to.to_account_info(),
            authority: ctx.accounts.collateral_from_authority.to_account_info(),
        };

        let cpi_program = ctx.accounts.token_program.clone();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount);

        // TODO: update vault debt_amount and collateral_amount
        // vault.collateral_amount = vault
        // .collateral_amount
        // .checked_add(self.amount)
        // .ok_or(Error::Overflow)?;

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
pub struct InitStake<'info> {
    vault_type: ProgramAccount<'info, VaultType>,

    #[account(has_one=vault_type)]
    vault: ProgramAccount<'info, Vault>,

    #[account(init)]
    stake: ProgramAccount<'info, Stake>,

    #[account("token_program.key == &token::ID")]
    token_program: AccountInfo<'info>,

    collateral_from: AccountInfo<'info>,

    // #[account(signer, "&collateral_from.owner == collateral_from_authority")]
    collateral_from_authority: AccountInfo<'info>,

    #[account("&vault_type.collateral_token_holder == collateral_to.key")]
    collateral_to: AccountInfo<'info>,

    rent: Sysvar<'info, Rent>,
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

#[account]
pub struct Stake {
    // belongs_to Vault
    vault: Pubkey,

    amount: u64,

    collateral_holder_nonce: u8,
}

// Define errors

#[error]
pub enum ParrotError {
    #[msg("ExampleError")]
    ExampleError,
}

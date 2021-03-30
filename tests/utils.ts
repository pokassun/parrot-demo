import { web3 } from "@project-serum/anchor";
import { sleep } from "@project-serum/common";
import { TokenInstructions } from "@project-serum/serum";
import { Token } from "@solana/spl-token";

export async function createToken(
  connection: web3.Connection,
  payer: web3.Account,
  mintAuthority: web3.PublicKey,
  decimals = 8
) {
  const token = await Token.createMint(
    connection,
    payer,
    mintAuthority,
    null,
    decimals,
    TokenInstructions.TOKEN_PROGRAM_ID
  );
  return token;
}

export async function newAccountWithLamports(
  connection: web3.Connection,
  lamports = 1e10
) {
  const account = new web3.Account();

  let retries = 30;
  await connection.requestAirdrop(account.publicKey, lamports);
  for (;;) {
    await sleep(500);
    // eslint-disable-next-line eqeqeq
    if (lamports == (await connection.getBalance(account.publicKey))) {
      return account;
    }
    if (--retries <= 0) {
      break;
    }
  }
  throw new Error(`Airdrop of ${lamports} failed`);
}

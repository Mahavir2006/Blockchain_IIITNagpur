import { concat, keccak256 } from "ethers";

// Same rules as contracts/libraries/MerkleLib.sol: leaves and internal nodes use different
// one-byte prefixes, so an internal node or the root can never pass as a delivery leaf.
const LEAF_PREFIX = "0x00";
const NODE_PREFIX = "0x01";

export function leafHash(leaf: string) {
  return keccak256(concat([LEAF_PREFIX, leaf.toLowerCase()]));
}

/** Hash of a sorted pair of nodes. */
export function hashPair(a: string, b: string) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x <= y ? keccak256(concat([NODE_PREFIX, x, y])) : keccak256(concat([NODE_PREFIX, y, x]));
}

/** Mirrors MerkleLib.verifyProof. */
export function verifyProof(root: string, leaf: string, proof: string[]) {
  let h = leafHash(leaf);
  for (const p of proof) h = hashPair(h, p);
  return h === root.toLowerCase();
}

/** Builds a tree (odd node carried up unchanged) and returns its root and a proof builder. */
export function buildTree(leaves: string[]) {
  if (leaves.length === 0) throw new Error("empty tree");
  const layers: string[][] = [leaves.map(leafHash)];
  while (layers[layers.length - 1].length > 1) {
    const level = layers[layers.length - 1];
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? hashPair(level[i], level[i + 1]) : level[i]);
    layers.push(next);
  }
  const proof = (index: number) => {
    const out: string[] = [];
    let idx = index;
    for (const layer of layers.slice(0, -1)) {
      const sib = idx ^ 1;
      if (sib < layer.length) out.push(layer[sib]);
      idx >>= 1;
    }
    return out;
  };
  return { root: layers[layers.length - 1][0], proof };
}

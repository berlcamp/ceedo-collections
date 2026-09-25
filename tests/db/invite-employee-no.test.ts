import { describe, expect, it } from "vitest";
import {
  createAppUser,
  serviceClient,
  uniqueCode,
  uniqueEmail,
} from "../helpers/supabase.js";

const service = serviceClient();

/**
 * Migration 0049: an invite whose employee number already belongs to someone else could
 * never be claimed (the claim's insert fails on app_users' unique employee_no), and the
 * invited person only ever saw /no-access. Found in production: an invite reused the
 * inviting admin's own number. It is now refused when it is made.
 */
describe("invite employee number", () => {
  it("refuses an invite whose employee number belongs to another member", async () => {
    const employeeNo = uniqueCode("TAKEN");
    await createAppUser({ email: "holder@example.com", role: "admin", employeeNo, fullName: "The Holder" });

    const { error } = await service.from("staff_invites").insert({
      email: uniqueEmail("newcomer@example.com"),
      employee_no: employeeNo,
      full_name: "Newcomer",
      role: "admin",
    });
    expect(error?.code).toBe("23514");
    expect(error?.message).toContain("already belongs to The Holder");
  });

  it("refuses changing a pending invite to a taken number", async () => {
    const employeeNo = uniqueCode("TAKEN");
    await createAppUser({ email: "holder2@example.com", role: "collector", employeeNo });

    const email = uniqueEmail("pending@example.com");
    const { error: insertError } = await service.from("staff_invites").insert({
      email,
      employee_no: uniqueCode("FREE"),
      full_name: "Pending",
      role: "supervisor",
    });
    expect(insertError).toBeNull();

    const { error } = await service
      .from("staff_invites")
      .update({ employee_no: employeeNo })
      .eq("email", email);
    expect(error?.code).toBe("23514");
  });

  it("allows re-inviting an existing member under their own number, to change their role", async () => {
    const employeeNo = uniqueCode("OWN");
    const { userId } = await createAppUser({ email: "reinvite@example.com", role: "supervisor", employeeNo });
    const { data: user } = await service.auth.admin.getUserById(userId);

    const { error } = await service.from("staff_invites").insert({
      email: user.user!.email!,
      employee_no: employeeNo,
      full_name: "Re-invited",
      role: "admin",
    });
    expect(error).toBeNull();
  });
});
